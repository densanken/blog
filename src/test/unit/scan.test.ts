import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";
import { parse } from "yaml";

it.each([1, 2])("warns and continues when ClamAV exits with %i", (code) => {
  const dir = mkdtempSync(join(tmpdir(), "scan-test-"));
  try {
    writeFileSync(
      join(dir, "clamscan"),
      `#!/bin/sh\nprintf '%s\\n' "$@" > "$SCAN_ARGS"\nprintf '%s\\n' 'a,b:c%0A.md: Test% FOUND'\nexit ${String(code)}\n`,
      {
        mode: 0o755,
      }
    );
    const action = parse(readFileSync(".github/actions/scan/action.yml", "utf8")) as {
      runs: { steps: { name: string; run: string }[] };
    };
    const script = action.runs.steps.find((step) => step.name === "Scan ${{ inputs.path }}")?.run;
    assert.ok(script);
    const output = execFileSync("bash", ["-c", script], {
      env: {
        ...process.env,
        PATH: `${dir}:${process.env.PATH ?? ""}`,
        SCAN_PATH: ".",
        SCAN_ARGS: join(dir, "args"),
      },
      encoding: "utf8",
    });
    expect(readFileSync(join(dir, "args"), "utf8").split("\n")).toContain("--remove");
    expect(output).toContain("::warning file=a%2Cb%3Ac%250A.md::");
    if (code === 2) expect(output).toContain("終了コード 2");
    expect(output).toContain("Test%25 FOUND");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("removes only the detected file and warns", () => {
  const dir = mkdtempSync(join(tmpdir(), "scan-test-"));
  try {
    const infected = join(dir, "infected: file.html");
    const healthy = join(dir, "healthy.html");
    writeFileSync(infected, "infected");
    writeFileSync(healthy, "healthy");
    writeFileSync(
      join(dir, "clamscan"),
      '#!/bin/sh\nremove=false\nfor arg do\n  [ "$arg" = --remove ] && remove=true\n  last=$arg\ndone\n[ "$remove" = true ] && [ "$last" = "$SCAN_PATH" ] || exit 2\nrm -- "$INFECTED"\nprintf "%s: Eicar FOUND\\n" "$INFECTED"\nexit 1\n',
      { mode: 0o755 }
    );
    const action = parse(readFileSync(".github/actions/scan/action.yml", "utf8")) as {
      runs: { steps: { run: string }[] };
    };
    const script = action.runs.steps[0]?.run;
    assert.ok(script);
    const output = execFileSync("bash", ["-c", script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, SCAN_PATH: dir, INFECTED: infected },
      encoding: "utf8",
    });
    expect(existsSync(infected)).toBe(false);
    expect(existsSync(healthy)).toBe(true);
    expect(output).toContain(`::warning file=${infected.replace(":", "%3A")}::`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("fails after reporting every detection if an infected file remains", () => {
  const dir = mkdtempSync(join(tmpdir(), "scan-test-"));
  try {
    const infected = join(dir, "infected.html");
    writeFileSync(infected, "infected");
    writeFileSync(
      join(dir, "clamscan"),
      '#!/bin/sh\nprintf "%s: Eicar FOUND\\nremoved.html: Other FOUND\\n" "$INFECTED"\nexit 1\n',
      { mode: 0o755 }
    );
    const action = parse(readFileSync(".github/actions/scan/action.yml", "utf8")) as {
      runs: { steps: { run: string }[] };
    };
    const script = action.runs.steps[0]?.run;
    assert.ok(script);
    const result = spawnSync("bash", ["-c", script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, SCAN_PATH: dir, INFECTED: infected },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(`::warning file=${infected}::`);
    expect(result.stdout).toContain("::warning file=removed.html::");
    expect(existsSync(infected)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("fails when ClamAV cannot remove a file whose name contains a newline", () => {
  const dir = mkdtempSync(join(tmpdir(), "scan-test-"));
  try {
    const infected = join(dir, "infected\nfile.html");
    writeFileSync(infected, "infected");
    writeFileSync(
      join(dir, "clamscan"),
      `#!/bin/sh\nprintf "%s: Eicar FOUND\\nERROR: Can't remove file '%s'\\n" "$INFECTED" "$INFECTED"\nexit 1\n`,
      { mode: 0o755 }
    );
    const action = parse(readFileSync(".github/actions/scan/action.yml", "utf8")) as {
      runs: { steps: { run: string }[] };
    };
    const script = action.runs.steps[0]?.run;
    assert.ok(script);
    const result = spawnSync("bash", ["-c", script], {
      env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}`, SCAN_PATH: dir, INFECTED: infected },
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("ClamAV could not remove an infected file");
    expect(existsSync(infected)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
