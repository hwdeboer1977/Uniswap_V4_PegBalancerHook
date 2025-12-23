// app/api/arbexecutor/toggle/route.ts

import { NextResponse } from "next/server";
import { spawn, exec } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";

const execAsync = promisify(exec);

// Path to your backend server
const SERVER_PATH = path.join(process.cwd(), "backend", "server.js");

// Store process reference in memory
// In production, use Redis or a database
let arbExecutorProcess: any = null;

// Check if server.js exists
function checkServerExists() {
  if (!fs.existsSync(SERVER_PATH)) {
    throw new Error(`server.js not found at ${SERVER_PATH}`);
  }
}

export async function POST(request: Request) {
  try {
    const { active } = await request.json();

    checkServerExists();

    if (active) {
      // START the ArbExecutor
      if (arbExecutorProcess && !arbExecutorProcess.killed) {
        return NextResponse.json({
          success: true,
          message: "ArbExecutor already running",
          active: true,
        });
      }

      console.log("🚀 Starting ArbExecutor...");
      console.log("Server path:", SERVER_PATH);

      // Spawn the process
      arbExecutorProcess = spawn("node", [SERVER_PATH], {
        cwd: path.join(process.cwd(), "backend"),
        stdio: "inherit", // This will show logs in your Next.js console
        detached: false,
      });

      arbExecutorProcess.on("error", (error: Error) => {
        console.error("❌ ArbExecutor error:", error);
      });

      arbExecutorProcess.on("exit", (code: number) => {
        console.log(`🛑 ArbExecutor exited with code ${code}`);
        arbExecutorProcess = null;
      });

      // Give it a moment to start
      await new Promise((resolve) => setTimeout(resolve, 1000));

      return NextResponse.json({
        success: true,
        message: "ArbExecutor started",
        active: true,
      });
    } else {
      // STOP the ArbExecutor
      if (!arbExecutorProcess || arbExecutorProcess.killed) {
        return NextResponse.json({
          success: true,
          message: "ArbExecutor not running",
          active: false,
        });
      }

      console.log("🛑 Stopping ArbExecutor...");

      // Send SIGINT signal (same as Ctrl+C)
      arbExecutorProcess.kill("SIGINT");

      // Wait a bit for graceful shutdown
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Force kill if still running
      if (!arbExecutorProcess.killed) {
        arbExecutorProcess.kill("SIGKILL");
      }

      arbExecutorProcess = null;

      return NextResponse.json({
        success: true,
        message: "ArbExecutor stopped",
        active: false,
      });
    }
  } catch (error: any) {
    console.error("Toggle error:", error);
    return NextResponse.json(
      {
        success: false,
        message: error.message,
        stack: error.stack,
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check current status
export async function GET() {
  try {
    checkServerExists();

    const isRunning = arbExecutorProcess && !arbExecutorProcess.killed;

    return NextResponse.json({
      success: true,
      active: isRunning,
      message: isRunning ? "ArbExecutor is running" : "ArbExecutor is stopped",
      serverPath: SERVER_PATH,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      active: false,
      message: error.message,
    });
  }
}
