import { describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { PgStore } from "./store.ts";

/**
 * PgStore against a real Postgres (CI service container; locally `SV_TEST_DATABASE_URL=…`): migrations
 * are idempotent, messages keep their order and content-block shape, one pending action per
 * conversation with TTL, retention purges old conversations with their messages and actions.
 */
const url = process.env.SV_TEST_DATABASE_URL;

describe.skipIf(!url)("PgStore (schema sv_ai on Postgres)", () => {
  test("migrate twice; conversations, messages, pending action, purge", async () => {
    const admin = new SQL(url!);
    await admin`DROP SCHEMA IF EXISTS sv_ai CASCADE`;
    const store = PgStore.connect(url!);
    await store.migrate();
    await store.migrate();

    const t = Date.now();
    await store.createConversation({ id: "c_1", userId: "u1", title: "Hazard", createdAt: t - 10_000, updatedAt: t - 10_000 });
    await store.createConversation({ id: "c_2", userId: "u1", title: "Old", createdAt: t - 5_000, updatedAt: t - 5_000 });
    await store.createConversation({ id: "c_3", userId: "u2", title: "Other user", createdAt: t, updatedAt: t });
    await store.touch("c_1", { workflowId: "wf-1" });
    expect((await store.conversations("u1")).map((c) => c.id)).toEqual(["c_1", "c_2"]); // most recently updated first
    expect(await store.conversation("c_1")).toMatchObject({ userId: "u1", title: "Hazard", workflowId: "wf-1" });
    expect(await store.conversation("missing")).toBeNull();

    await store.append("c_1", [{ role: "user", content: [{ type: "text", text: "Bật đèn cảnh báo" }] }]);
    await store.append("c_1", [
      { role: "assistant", content: [{ type: "text", text: "OK" }, { type: "tool_use", id: "t1", name: "workflow_get", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "{}" }] },
    ]);
    const messages = await store.messages("c_1");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(messages[0]!.content).toEqual([{ type: "text", text: "Bật đèn cảnh báo" }]);
    expect(messages[1]!.content).toEqual([{ type: "text", text: "OK" }, { type: "tool_use", id: "t1", name: "workflow_get", input: {} }]);

    const action = { actionId: "a1", conversationId: "c_1", toolName: "run_start", toolUseId: "t2", toolInput: { projectId: "p" }, otherResults: [], createdAt: t, expiresAt: t + 60_000 };
    await store.setPending(action);
    expect(await store.pending("c_1")).toEqual(action);
    await expect(store.setPending({ ...action, actionId: "a2" })).rejects.toThrow(); // one per conversation
    await store.clearPending("c_1");
    expect(await store.pending("c_1")).toBeNull();
    await store.setPending({ ...action, actionId: "a3", expiresAt: t - 1 });
    expect(await store.pending("c_1")).toBeNull(); // expired ⇒ dropped

    await store.setPending({ ...action, conversationId: "c_2", actionId: "a4" });
    await store.append("c_2", [{ role: "user", content: [{ type: "text", text: "x" }] }]);
    await admin`UPDATE sv_ai.conversation SET updated_at = to_timestamp(${(t - 5_000) / 1000}) WHERE id = 'c_2'`;
    expect(await store.purge(t - 1_000)).toBe(1);
    expect(await store.conversation("c_2")).toBeNull();
    expect(await store.messages("c_2")).toEqual([]);
    expect(await store.pending("c_2")).toBeNull();
    expect(await store.conversation("c_1")).not.toBeNull();
    await admin.close();
  });
});
