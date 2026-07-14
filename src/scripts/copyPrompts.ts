#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const sourceDir = path.join(process.cwd(), "src", "prompts");
const targetDir = path.join(process.cwd(), "dist", "prompts");

function copyMarkdownFiles(from: string, to: string) {
  if (!existsSync(from)) {
    return;
  }

  mkdirSync(to, { recursive: true });

  for (const entry of readdirSync(from)) {
    const sourcePath = path.join(from, entry);
    const targetPath = path.join(to, entry);
    const stat = statSync(sourcePath);

    if (stat.isDirectory()) {
      copyMarkdownFiles(sourcePath, targetPath);
    } else if (entry.endsWith(".md")) {
      cpSync(sourcePath, targetPath);
    }
  }
}

copyMarkdownFiles(sourceDir, targetDir);
