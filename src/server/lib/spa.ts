import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

// A miss under the backend namespaces is a missing endpoint, not a client-side
// route: answer it with a JSON 404 instead of index.html with 200.
const BACKEND_PATH = /^\/(?:api|ws)(?:[/?]|$)/;

/** Serves the built web SPA from `webDistDir`, falling back to index.html. */
export async function registerSpa(
  app: FastifyInstance,
  webDistDir: string,
): Promise<void> {
  await app.register(fastifyStatic, {
    root: webDistDir,
    wildcard: false,
  });
  app.setNotFoundHandler((req, reply) => {
    if (BACKEND_PATH.test(req.url)) {
      reply.status(404).send({ error: "Not found" });
      return;
    }
    reply.sendFile("index.html", webDistDir);
  });
}
