import { spawnSync } from "node:child_process";
const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "supabase/functions/uploadContentFileToReviewStudio/_tests/run-tests.ts"], {
  cwd: "C:/Users/MYPC/Desktop/KDP-Intake",
  encoding: "utf8",
});
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
process.exit(r.status ?? 0);