import readline from "readline";

// Singleton readline interface
let readLineInterface: readline.Interface | null = null;

function getReadLineInterface() {
  if (!readLineInterface) {
    readLineInterface = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return readLineInterface;
}

function closeReadLineInterface() {
  if (readLineInterface) {
    readLineInterface.close();
    readLineInterface = null;
  }
}

export async function confirmMessage(message: string) {
  const rl = getReadLineInterface();

  return new Promise<boolean>((resolve) => {
    rl.question(message, (answer: string) => {
      closeReadLineInterface();
      resolve(answer.toLowerCase() === "yes" || answer.toLowerCase() === "y");
    });
  });
}
