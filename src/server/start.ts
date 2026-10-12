import { type AddressInfo } from "node:net";
import { createCcdeskServer, type ServerOptions } from "./server.ts";

export interface StartOptions extends ServerOptions {
  /** 0 picks a free port. */
  port: number;
}

export interface RunningServer {
  /** The page's address on 127.0.0.1, with the token in its fragment. */
  url: string;
  /** Stops listening and drops open connections, such as a browser tab's. */
  close: () => Promise<void>;
}

/** Serves `options.core` on 127.0.0.1; rejects when it cannot listen, such as on a port in use. */
export function startServer(options: StartOptions): Promise<RunningServer> {
  const server = createCcdeskServer(options);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, "127.0.0.1", () => {
      server.off("error", reject);
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}/#token=${options.token}`,
        close: () =>
          new Promise((closed, failed) => {
            server.close((error) => (error ? failed(error) : closed()));
            // An open browser tab keeps a connection alive, which would hold close() open.
            server.closeAllConnections();
          }),
      });
    });
  });
}
