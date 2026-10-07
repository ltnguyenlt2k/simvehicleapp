# syntax=docker/dockerfile:1.7
# SimVehicleApp ide-cpp = toolchain-cpp (same Velocitas env as the build pipeline) + code-server.
FROM toolchain AS ide
ARG CODE_SERVER_VERSION=4.139.1
USER root
RUN arch=$(dpkg --print-architecture) \
 && curl -fsSL -o /tmp/cs.deb "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server_${CODE_SERVER_VERSION}_${arch}.deb" \
 && dpkg -i /tmp/cs.deb && rm /tmp/cs.deb
COPY cpp/extensions.txt /opt/sv/ide/extensions.txt
COPY settings/ /opt/sv/ide/settings/
COPY cpp/sv-ide-entrypoint.sh /usr/local/bin/sv-ide-entrypoint
COPY cpp/sv-run-on-stack.sh /usr/local/bin/sv-run-on-stack
RUN chmod 0755 /usr/local/bin/sv-ide-entrypoint /usr/local/bin/sv-run-on-stack && mkdir -p /opt/sv/ide/extensions && chown -R vscode:vscode /opt/sv/ide
USER vscode
# Extensions from Open VSX only (license-compatible with code-server; no ms-vscode.cpptools / Pylance).
RUN sed -e 's/#.*//' -e '/^[[:space:]]*$/d' /opt/sv/ide/extensions.txt | xargs -n1 code-server --extensions-dir /opt/sv/ide/extensions --install-extension
EXPOSE 8080
ENTRYPOINT ["sv-ide-entrypoint"]
CMD ["/workspace"]
