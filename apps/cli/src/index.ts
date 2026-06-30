#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectVsite, packageVeloraSite, validateVeloraSite } from "@velora/shared/velora-site-node";

const [, , command, ...args] = process.argv;

const handlers: Record<string, () => Promise<void>> = {
  init: async () => {
    const dir = resolve(args[0] ?? ".");
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "velora.json"),
      JSON.stringify(
        {
          formatVersion: 1,
          address: "shop.demo",
          title: "Demo Velora",
          description: "Sito dimostrativo pubblicato sulla rete Velora",
          category: "shop",
          entryFile: "index.html",
          languages: ["it"],
          keywords: ["demo", "shop", "velora"],
          version: "1.0.0",
          ageRating: "EVERYONE",
          familySafe: true,
          permissions: {
            externalNetwork: false,
            clipboardRead: false,
            clipboardWrite: false,
            notifications: false,
            fileDownload: false
          },
          allowedExternalOrigins: []
        },
        null,
        2
      )
    );
    await writeFile(join(dir, ".veloraignore"), [".git", "node_modules", ".env", "*.log", "src", "tests"].join("\n"));
    await writeFile(join(dir, "README-velora.md"), "# Velora Site\n");
    console.log(`Initialized Velora site in ${dir}`);
  },
  validate: async () => {
    const target = resolve(args[0] ?? ".");
    console.log(JSON.stringify(await validateVeloraSite(target), null, 2));
  },
  package: async () => {
    const target = resolve(args[0] ?? ".");
    const output = resolve(args[1] ?? join(target, "dist", "site.vsite"));
    console.log(JSON.stringify(await packageVeloraSite(target, output), null, 2));
  },
  inspect: async () => {
    const target = resolve(args[0]);
    console.log(JSON.stringify(await inspectVsite(target), null, 2));
  },
  publish: async () => {
    const address = args[0];
    const target = resolve(args[1] ?? ".");
    const output = resolve(join(target, "dist", `${address.replace(".", "_")}.vsite`));
    console.log(JSON.stringify(await packageVeloraSite(target, output), null, 2));
  },
  whoami: async () => console.log("Not connected to a persistent auth profile yet."),
  login: async () => console.log("CLI login flow is not connected yet."),
  logout: async () => console.log("CLI logout flow is not connected yet."),
  zones: async () => console.log("[]"),
  status: async () => console.log(JSON.stringify({ status: "NOT_CONNECTED" }, null, 2)),
  releases: async () => console.log("[]"),
  rollback: async () => console.log(JSON.stringify({ status: "NOT_CONNECTED" }, null, 2)),
  revoke: async () => console.log(JSON.stringify({ status: "NOT_CONNECTED" }, null, 2)),
  "zone check": async () => console.log(JSON.stringify({ status: "NOT_CONNECTED" }, null, 2)),
  "zone request": async () => console.log(JSON.stringify({ status: "NOT_CONNECTED" }, null, 2))
};

const key = command === "zone" ? `zone ${args.shift() ?? ""}` : command;
if (!key || !handlers[key]) {
  console.error("Available commands: init, validate, package, inspect, publish, login, logout, whoami, zones, zone check, zone request, status, releases, rollback, revoke");
  process.exit(1);
}

await handlers[key]();
