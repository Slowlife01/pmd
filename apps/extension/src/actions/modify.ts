import { commands, ExtensionContext, Uri, window } from "vscode";

import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import OutputTerminal from "../util/OutputTerminal.js";
import fetchTemplate from "../functions/fetchTemplate.js";
import getPresences from "../functions/getPresences";
import { installDependencies, workspaceFolder } from "../extension.js";

import getFolderLetter from "@pmd/cli/src/functions/getFolderLetter.js";

import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

import kill from "tree-kill";

interface Presence {
  service: string;
  url: string | string[];
}

let isRunning = false;
let started = false;

export default async function modifyPresence(context: ExtensionContext, retry = false): Promise<any> {

  if (isRunning) return window.showErrorMessage("pmd is already running.");
  if (!areDependenciesInstalled()) {
    return window.showErrorMessage(
      "You need to have the dependencies installed to use this command.",
      "Install Dependencies"
    ).then(async (choice) => {
      if (choice === "Install Dependencies") {
        installDependencies()
          .then(() => {
            window.showInformationMessage("Rerun the commmand?", "Yes").then((choice) => {
              if (choice === "Yes") modifyPresence(context);
            });
          })
          .catch(() => { });
      }
    });
  }

  let service: string | undefined;

  const editingPresence = window.activeTextEditor?.document.uri.path.split("websites/")[1];
  if (editingPresence) {
    const [folder, serviceName] = editingPresence.split("/");
    if (folder && serviceName) service = serviceName
  } else {
    const loadingStatus = window.setStatusBarMessage(
      "$(loading~spin) Loading the Presences..."
    );

    const presences: Presence[] = await getPresences();
    loadingStatus.dispose();

    // Sometimes it just fails to load the presences
    if (!presences.length && !retry) {
      window.setStatusBarMessage(
        "$(error) Failed to load the Presences. Trying again...",
        1000
      );
      return modifyPresence(context, true);
    } else if (!presences.length) {
      return window.showErrorMessage(
        "Failed to load the Presences."
      );
    }

    service = (
      await window.showQuickPick(
        presences.map(({ service, url }) => ({ label: service, detail: Array.isArray(url) ? url[0] : url })),
        {
          title: "Select a presence to modify",
          ignoreFocusOut: true,
          matchOnDetail: true
        }
      )
    )?.label;
  }

  if (!service) return;
  isRunning = true;

  const presencePath = resolve(
    `${workspaceFolder}/websites/${getFolderLetter(service)}/${service.replace("!", " ").trim()}`
  );

  const terminal = new OutputTerminal(service);
  terminal.show();

  await writeFile(
    resolve(presencePath, "tsconfig.json"),
    JSON.stringify(await fetchTemplate("tsconfig.json"), null, 2)
  );

  const status = window.createStatusBarItem();
  status.text = "$(loading~spin) Starting pmd...";
  status.command = "stopCompiler";
  status.show();

  const job = spawn("npx", ["pmd", "-m", `"${service}"`], {
    shell: true,
    cwd: workspaceFolder
  });

  job.stdout.on("data", (data) => {
    if (data.toString().includes("Starting TypeScript")) {
      started = true;
      status.text = `$(stop) Stop pmd - ${service}`;

      window.showInformationMessage(`Compiler started for ${service}`, "Open presence.ts", "Open metadata.json").then((choice) => {
        switch (choice) {
          case "Open presence.ts":
            window.showTextDocument(
              Uri.file(resolve(presencePath, "presence.ts"))
            );
            break;
          case "Open metadata.json":
            window.showTextDocument(
              Uri.file(resolve(presencePath, "metadata.json"))
            );
            break;
        }
      });
    } else if (data.toString().includes("Recompiling")) {
      terminal.clear();
    }

    terminal.appendLine(data.toString().trim());
  });

  job.stderr.on("data", (data) => {
    terminal.appendLine(data.toString().trim())
    if (!started) {
      status.dispose();
      command.dispose();
      isRunning = false;
      started = false;
      if (job.pid) kill(job.pid)
    }
  });

  const command = commands.registerCommand(
    "stopCompiler",
    async () => {
      status.text = "$(loading~spin) Stopping pmd...";
      isRunning = false;
      started = false;

      if (job.pid) kill(job.pid)

      status.dispose();
      terminal.dispose();
      command.dispose();
    }
  );
}

function areDependenciesInstalled() {
  return existsSync(`${workspaceFolder}/node_modules`);
}