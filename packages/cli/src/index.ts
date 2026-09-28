#!/usr/bin/env node
import { OWRClient, waitForTask } from "@owr/sdk";

function value(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function usage(): never {
  console.error(`Open Web Runtime CLI

Usage:
  owr run --goal "..." [--url https://example.com]
  owr get --task <id>
  owr inspect --task <id>
  owr artifacts --task <id>
  owr approve --task <id>
  owr deny --task <id>

Options:
  --api <url>      API base URL (default OWR_API_URL or http://localhost:8787)
  --token <token>  API bearer token (default OWR_API_TOKEN)
`);
  process.exit(2);
}

const [command] = process.argv.slice(2);
if (!command || command.startsWith("--")) usage();

const client = new OWRClient({
  baseUrl: value("--api") ?? process.env.OWR_API_URL,
  token: value("--token") ?? process.env.OWR_API_TOKEN
});

if (command === "run") {
  const goal = value("--goal");
  if (!goal) usage();
  const task = await client.createTask({
    goal,
    startUrl: value("--url"),
    autoRun: true
  });
  console.error(`task ${task.id}`);
  console.error(`inspect ${client.inspectorUrl(task.id)}`);
  const final = await waitForTask(client, task.id);
  console.log(JSON.stringify(final, null, 2));
  process.exit(final.status === "completed" ? 0 : final.status === "waiting_for_approval" ? 3 : 1);
}

if (command === "get") {
  const taskId = value("--task");
  if (!taskId) usage();
  console.log(JSON.stringify(await client.getTask(taskId), null, 2));
  process.exit(0);
}

if (command === "inspect") {
  const taskId = value("--task");
  if (!taskId) usage();
  console.log(client.inspectorUrl(taskId));
  process.exit(0);
}

if (command === "artifacts") {
  const taskId = value("--task");
  if (!taskId) usage();
  console.log(JSON.stringify(await client.listArtifacts(taskId), null, 2));
  process.exit(0);
}

if (command === "approve" || command === "deny") {
  const taskId = value("--task");
  if (!taskId) usage();
  console.log(JSON.stringify(await client.approve(taskId, command === "approve"), null, 2));
  process.exit(0);
}

usage();
