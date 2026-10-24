import { createApp } from "./app";
import { createMockUpstream } from "./upstream";

const port = Number(process.env.PORT ?? 3000);
createApp({ upstream: createMockUpstream() }).listen(port, () => {
  console.log(`Weather API listening on http://localhost:${port}`);
});
