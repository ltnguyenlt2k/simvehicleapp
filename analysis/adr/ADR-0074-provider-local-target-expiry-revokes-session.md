# ADR-0074: Local target expiry revokes provider authority

Status: Accepted under PO delegation, 2026-10-29, M23-T08 fault correction.

The actual separate-process network-flap test failed: local velocity reached zero
at the target deadline, but the broker's old lease survived a short outage and
could still authorize queued targets after reconnect. Zero velocity alone does
not prove revoked authority. Original failing evidence is retained in M23 progress.

If a provider's own watchdog expires an active target before a broker safe-value
dispatch arrives, it now invalidates the whole fence, clears target authority,
cancels commands, latches backend loss/STOP and restarts its provider session.
This does not depend on a working broker connection. New provider handshake
revokes the old broker lease. Buffered old session/fence frames cannot actuate.
Recovery requires explicit ResetStop, a fresh lease and explicit Arm.

An explicit safe release received within deadline remains a normal operation.
Broker-controlled nominal TTL safe dispatch keeps its existing behavior. This
change conservatively treats independently detected missing refresh as lost
authority; it does not attempt to distinguish crashed writers from network loss.
No physical E-stop or real robot stopping-distance claim is implied.
