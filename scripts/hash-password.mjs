import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("対話可能なターミナルで実行してください。");
  }
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
    };
    const onData = (character) => {
      if (character === "\u0003") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("中断しました。"));
      } else if (character === "\r" || character === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(input);
      } else if (character === "\u007f") {
        input = input.slice(0, -1);
      } else {
        input += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

const password = await readHidden("共有パスワード（12文字以上）: ");
const confirmation = await readHidden("もう一度入力: ");
if (password !== confirmation) throw new Error("入力が一致しません。");
if (password.length < 12) throw new Error("12文字以上にしてください。");

const salt = randomBytes(16);
const derived = await scrypt(password, salt, 64);
process.stdout.write(`APP_PASSWORD_HASH=scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}\n`);
