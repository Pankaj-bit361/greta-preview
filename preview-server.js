const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const { exec } = require("child_process");
const fetch = require("node-fetch");
const { promisify } = require("util");
const cors = require("cors");

// Add logger utility
function log(message, type = "info", error = null) {
  const timestamp = new Date().toISOString();
  const logMessage = {
    timestamp,
    type,
    message,
    ...(error && { error: error.message, stack: error.stack }),
  };
  console.log(JSON.stringify(logMessage, null, 2));
}

const execAsync = promisify(exec);
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(cors());

const BASE_TEMPLATE_DIR = path.join(__dirname, "template");
const PREVIEW_DIR = path.join(__dirname, "previews");

// Ensure directories exist
try {
  fs.ensureDirSync(PREVIEW_DIR);
  fs.ensureDirSync(BASE_TEMPLATE_DIR);
  log("Directories initialized successfully");
} catch (error) {
  log("Failed to create directories", "error", error);
  process.exit(1);
}

const VERCEL_AUTH_TOKEN = "kuQDam0Wg4IK2r6vmCu3EANQ";

async function installAdditionalDependencies(sitePath, dependencies) {
  try {
    const depString = dependencies.join(" ");
    log(`Installing additional dependencies: ${depString}`);
    const result = await execAsync(`npm install ${depString}`, {
      cwd: sitePath,
    });
    log(`Dependencies installed successfully: ${result.stdout}`);
  } catch (error) {
    log("Failed to install additional dependencies", "error", error);
    throw error;
  }
}

async function getFilesForVercel(sitePath) {
  try {
    const files = [];
    log(`Starting to process directory: ${sitePath}`);

    // Required files for Vercel deployment
    const requiredFiles = ["package.json", "index.html", "vite.config.ts"];

    // Add required files
    for (const file of requiredFiles) {
      const filePath = path.join(sitePath, file);
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath);
        files.push({
          file,
          data: content.toString("base64"),
          encoding: "base64",
        });
        log(`Processed file: ${file}`);
      }
    }

    // Add source files
    const srcPath = path.join(sitePath, "src");
    if (await fs.pathExists(srcPath)) {
      async function processSrcDirectory(currentPath, basePath = "src") {
        const entries = await fs.readdir(currentPath, { withFileTypes: true });

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry.name);
          const relativePath = path.join(basePath, entry.name);

          if (entry.isDirectory()) {
            await processSrcDirectory(fullPath, relativePath);
          } else {
            const content = await fs.readFile(fullPath);
            files.push({
              file: relativePath,
              data: content.toString("base64"),
              encoding: "base64",
            });
            log(`Processed file: ${relativePath}`);
          }
        }
      }

      await processSrcDirectory(srcPath);
    }

    // Also include any other necessary configuration files at root level
    const configFiles = ["tsconfig.json", "tsconfig.node.json"];
    for (const file of configFiles) {
      const filePath = path.join(sitePath, file);
      if (await fs.pathExists(filePath)) {
        const content = await fs.readFile(filePath);
        files.push({
          file,
          data: content.toString("base64"),
          encoding: "base64",
        });
        log(`Processed config file: ${file}`);
      }
    }

    log(`Completed processing ${files.length} files`);
    return files;
  } catch (error) {
    log("Failed to process files for Vercel", "error", error);
    throw error;
  }
}

async function deployToVercel(sitePath) {
  try {
    // Build the site
    log("Starting build process");
    const buildResult = await execAsync("npm run build", { cwd: sitePath });
    log(`Build completed: ${buildResult.stdout}`);

    // First verify the token and get team info
    log("Verifying Vercel token and getting team info");
    const userResponse = await fetch("https://api.vercel.com/v2/user", {
      headers: {
        Authorization: `Bearer ${VERCEL_AUTH_TOKEN}`,
      },
    });

    if (!userResponse.ok) {
      const responseText = await userResponse.text();
      log("Token verification failed", "error", new Error(responseText));
      throw new Error(`Invalid token or permissions: ${responseText}`);
    }

    const userData = await userResponse.json();
    log("Token verified successfully", "info", { userId: userData.id });

    // Get team info if available
    const teamId = userData.teamId;
    log("Team info retrieved", "info", { teamId });

    // Create project with verified credentials
    log("Creating Vercel project");
    const createProjectResponse = await fetch(
      "https://api.vercel.com/v9/projects",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VERCEL_AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `preview-${Date.now()}`,
          framework: "vite",
        }),
      }
    );

    if (!createProjectResponse.ok) {
      const responseText = await createProjectResponse.text();
      log("Project creation failed", "error", new Error(responseText));
      throw new Error(
        `Failed to create project: ${createProjectResponse.status} ${responseText}`
      );
    }

    const projectData = await createProjectResponse.json();
    log("Project created successfully", "info", { projectId: projectData.id });

    // Prepare files for deployment
    log("Preparing files for deployment");
    const files = await getFilesForVercel(sitePath);
    log(`Prepared ${files.length} files for deployment`);

    // Deploy to Vercel
    const deploymentResponse = await fetch(
      `https://api.vercel.com/v13/deployments?teamId=${teamId || ""}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VERCEL_AUTH_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: `preview-${Date.now()}`,
          files,
          framework: "vite",
          projectSettings: {
            framework: "vite",
            buildCommand: "npm run build",
            outputDirectory: "dist",
            installCommand: "npm install",
            devCommand: "vite"
          }
        }),
      }
    );

    if (!deploymentResponse.ok) {
      const responseText = await deploymentResponse.text();
      log("Deployment failed", "error", new Error(responseText));
      throw new Error(
        `Failed to deploy: ${deploymentResponse.status} ${responseText}`
      );
    }

    const deployData = await deploymentResponse.json();
    log("Deployment completed successfully", "info", {
      url: deployData.url,
      deploymentId: deployData.id,
    });

    return {
      url: `https://${deployData.url}`,
      deployment_id: deployData.id,
      project_id: projectData.id,
    };
  } catch (error) {
    log("Deployment process failed", "error", error);
    throw error;
  }
}

async function initializeBaseTemplate() {
  try {
    log("Initializing base template");

    const baseFiles = {
      "index.html": `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Preview</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>`,

      "src/main.tsx": `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  );
}`,

      "src/App.tsx": `import React from 'react';

function App() {
  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold mb-4">Welcome to the App</h1>
      </div>
    </div>
  );
}

export default App;`,

      "src/styles.css": `@tailwind base;
@tailwind components;
@tailwind utilities;`,

      "package.json": JSON.stringify(
        {
          name: "preview",
          private: true,
          version: "0.0.0",
          type: "module",
          scripts: {
            dev: "vite",
            build: "vite build",
            preview: "vite preview",
          },
          dependencies: {
            "react": "^18.2.0",
            "react-dom": "^18.2.0",
            "react-router-dom": "^6.21.1",
            "lucide-react": "^0.344.0",
          },
          devDependencies: {
            "@types/react": "^18.2.0",
            "@types/react-dom": "^18.2.0",
            "@vitejs/plugin-react": "^4.0.0",
            "typescript": "^5.0.2",
            "vite": "^5.0.0",
            "autoprefixer": "^10.4.13",
            "postcss": "^8.4.49",
            "tailwindcss": "^3.4.17",
            "path" : "^0.12.7"
          }
        },
        null,
        2
      ),

      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            target: "ESNext",
            lib: ["DOM", "DOM.Iterable", "ESNext"],
            module: "ESNext",
            skipLibCheck: true,
            moduleResolution: "bundler",
            allowImportingTsExtensions: true,
            resolveJsonModule: true,
            isolatedModules: true,
            noEmit: true,
            jsx: "react-jsx",
            strict: true,
            noUnusedLocals: true,
            noUnusedParameters: true,
            noFallthroughCasesInSwitch: true,
            baseUrl: "."
          },
          include: ["src"],
          references: [{ path: "./tsconfig.node.json" }]
        },
        null,
        2
      ),

      "tsconfig.node.json": JSON.stringify(
        {
          compilerOptions: {
            composite: true,
            skipLibCheck: true,
            module: "ESNext",
            moduleResolution: "bundler",
            allowSyntheticDefaultImports: true
          },
          include: ["vite.config.ts"]
        },
        null,
        2
      ),

      "vite.config.ts": `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});`,
    };

    for (const [filePath, content] of Object.entries(baseFiles)) {
      const fullPath = path.join(BASE_TEMPLATE_DIR, filePath);
      await fs.ensureDir(path.dirname(fullPath));
      await fs.writeFile(fullPath, content);
      log(`Created template file: ${filePath}`);
    }

    log("Installing base dependencies");
    await execAsync("npm install", { cwd: BASE_TEMPLATE_DIR });
    log("Base template initialized successfully");
  } catch (error) {
    log("Failed to initialize base template", "error", error);
    throw error;
  }
}

app.post("/api/preview/create", async (req, res) => {
  const startTime = Date.now();
  let previewPath = null;

  try {
    const { id, files, dependencies = [] } = req.body;
    log(`Starting preview creation for ID: ${id}`);

    previewPath = path.join(PREVIEW_DIR, id);
    await fs.ensureDir(previewPath);
    log(`Created preview directory: ${previewPath}`);

    await fs.copy(BASE_TEMPLATE_DIR, previewPath);
    log("Copied template files");

    // Process files
    for (const file of files) {
      try {
        const filePath = path.join(previewPath, file.path);

        if (file.type === "folder") {
          await fs.ensureDir(filePath);
          log(`Created folder: ${file.path}`);

          if (file.children) {
            for (const childFile of file.children) {
              const childPath = path.join(previewPath, childFile.path);
              await fs.ensureDir(path.dirname(childPath));
              let content = childFile.content;
              if (content.startsWith("```")) {
                const lines = content.split("\n");
                content = lines.slice(1, -1).join("\n");
              }
              await fs.writeFile(childPath, content);
              log(`Created child file: ${childFile.path}`);
            }
          }
        } else {
          await fs.ensureDir(path.dirname(filePath));
          let content = file.content;
          if (content.startsWith("```")) {
            const lines = content.split("\n");
            content = lines.slice(1, -1).join("\n");
          }
          await fs.writeFile(filePath, content);
          log(`Created file: ${file.path}`);
        }
      } catch (error) {
        log(`Failed to process file: ${file.path}`, "error", error);
        throw error;
      }
    }

    log("Installing dependencies");
    await execAsync("npm install", { cwd: previewPath });

    if (dependencies.length > 0) {
      await installAdditionalDependencies(previewPath, dependencies);
    }

    log("Starting Vercel deployment");
    const deploymentResult = await deployToVercel(previewPath);

    const duration = Date.now() - startTime;
    log(`Preview creation completed in ${duration}ms`, "info", {
      id,
      url: deploymentResult.url,
      duration,
    });

    // Clean up the preview directory after successful deployment
    // if (previewPath) {
    //   await fs.remove(previewPath);
    //   log(`Cleaned up preview directory: ${previewPath}`);
    // }

    res.json({
      url: deploymentResult.url,
      deployment_id: deploymentResult.deployment_id,
      project_id: deploymentResult.project_id,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    log(`Preview creation failed after ${duration}ms`, "error", error);

    // Clean up the preview directory even if deployment failed
    if (previewPath) {
      try {
        // await fs.remove(previewPath);
        // log(`Cleaned up preview directory after failure: ${previewPath}`);
      } catch (cleanupError) {
        log("Failed to clean up preview directory", "error", cleanupError);
      }
    }

    res.status(500).json({
      error: error.message,
      details: error.stack,
    });
  }
});

// Add error handling middleware
app.use((err, req, res, next) => {
  log('Unhandled error in request', 'error', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Add 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

// Initialize and start server
initializeBaseTemplate()
  .then(() => {
    const port = process.env.PORT || 5000;
    app.listen(port, () => {
      log(`Preview server running on port ${port}`);
    });
  })
  .catch((err) => {
    log("Failed to initialize base template", "error", err);
    process.exit(1);
  });