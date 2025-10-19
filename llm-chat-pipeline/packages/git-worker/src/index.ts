import "dotenv/config";
import express from "express";
import morgan from "morgan";
import simpleGit from "simple-git";

const PORT = Number(process.env.GIT_WORKER_PORT || 3500);
const API_TOKEN = process.env.API_TOKEN || "";
const BRANCH = process.env.GIT_BRANCH || "main";
const REMOTE_URL = process.env.GIT_REMOTE_URL;
const USER_NAME = process.env.GIT_USER_NAME || "CI Bot";
const USER_EMAIL = process.env.GIT_USER_EMAIL || "ci@local";

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${API_TOKEN}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));
app.use(authenticate);

app.post("/commit", async (req, res) => {
  try {
    if (!REMOTE_URL) {
      return res.status(400).json({ error: "GIT_REMOTE_URL is not configured" });
    }
    const git = simpleGit({ baseDir: process.cwd() });
    await git.addConfig("user.name", USER_NAME);
    await git.addConfig("user.email", USER_EMAIL);
    const remotes = await git.getRemotes(true);
    if (!remotes.find((remote) => remote.name === "origin")) {
      await git.addRemote("origin", REMOTE_URL);
    }
    await git.fetch("origin");
    await git.checkout(BRANCH).catch(async () => {
      await git.checkoutLocalBranch(BRANCH);
    });
    await git.pull("origin", BRANCH, { "--rebase": null }).catch(() => undefined);
    await git.add(["dist/site"]);
    const message = req.body?.message || `Update site ${new Date().toISOString()}`;
    const status = await git.status();
    if (status.staged.length === 0 && status.created.length === 0 && status.deleted.length === 0 && status.modified.length === 0) {
      return res.json({ status: "nothing to commit" });
    }
    await git.commit(message);
    await git.push("origin", BRANCH);
    res.json({ status: "committed", branch: BRANCH });
  } catch (error: any) {
    res.status(400).json({ error: error.message ?? String(error) });
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Git worker listening on port ${PORT}`);
});
