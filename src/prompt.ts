import { createInterface as createCallbackInterface } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

export async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input, output });

  try {
    const answer = await rl.question(question);
    return answer.trim();
  } finally {
    rl.close();
  }
}

export async function promptPassword(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createCallbackInterface({ input, output });
    const mutableRl = rl as typeof rl & {
      stdoutMuted?: boolean;
      _writeToOutput?: (text: string) => void;
    };

    mutableRl.stdoutMuted = true;
    mutableRl._writeToOutput = (text: string) => {
      output.write(mutableRl.stdoutMuted && text !== "\n" ? "*" : text);
    };

    rl.question(question, (answer) => {
      mutableRl.stdoutMuted = false;
      rl.close();
      output.write("\n");
      resolve(answer.trim());
    });
  });
}
