# syntax=docker/dockerfile:1.7
# SimVehicleApp ide-python = toolchain-python (same Velocitas env as the build pipeline) + code-server (ADR-0040, ADR-0028).
FROM toolchain AS ide
ARG CODE_SERVER_VERSION=4.139.1
USER root
RUN arch=$(dpkg --print-architecture) \
 && curl -fsSL -o /tmp/cs.deb "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_${arch}.deb" \
 && dpkg -i /tmp/cs.deb && rm /tmp/cs.deb
COPY python/extensions.txt /opt/sv/ide/extensions.txt
COPY python/settings/ /opt/sv/ide/settings/
COPY cpp/sv-ide-entrypoint.sh /usr/local/bin/sv-ide-entrypoint
COPY python/sv-run-on-stack.sh /usr/local/bin/sv-run-on-stack
RUN chmod 0755 /usr/local/bin/sv-ide-entrypoint /usr/local/bin/sv-run-on-stack && mkdir -p /opt/sv/ide/extensions && chown -R vscode:vscode /opt/sv/ide
USER vscode
# Extensions from Open VSX only (license-compatible with code-server; no Pylance — basedpyright instead).
RUN sed -e 's/#.*//' -e '/^[[:space:]]*$/d' /opt/sv/ide/extensions.txt | xargs -n1 code-server --extensions-dir /opt/sv/ide/extensions --install-extension
EXPOSE 8080
# The toolchain image's healthcheck probes its agent (:4220), which the IDE does not run: probe code-server.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=3 CMD curl -fsS http://127.0.0.1:8080/healthz >/dev/null || exit 1
ENTRYPOINT ["sv-ide-entrypoint"]
CMD ["/workspace"]
