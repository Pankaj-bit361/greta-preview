const express = require("express");
const fs = require("fs-extra");
const path = require("path");
const { exec } = require("child_process");
const { promisify } = require("util");
const cors = require("cors");

function log(message, type = "info", error = null) {
  const timestamp = new Date().toISOString();
  // const logMessage = {
  //   timestamp,
  //   type,
  //   message,
  //   ...(error && { error: error.message, stack: error.stack }),
  // };
  console.log(JSON.stringify(message, null, 2));
}

const execAsync = promisify(exec);
const app = express();

app.use(express.json({ limit: "50mb" }));
app.use(cors());

const BASE_TEMPLATE_DIR = path.join(__dirname, "template");
const PREVIEW_DIR = path.join(__dirname, "previews");
const PUBLIC_DIR = path.join(__dirname, "public");

try {
  fs.ensureDirSync(PREVIEW_DIR);
  fs.ensureDirSync(BASE_TEMPLATE_DIR);
  fs.ensureDirSync(PUBLIC_DIR);
  log("Directories initialized successfully");
} catch (error) {
  log("Failed to create directories", "error", error);
  process.exit(1);
}

app.use("/preview", express.static(PUBLIC_DIR));

async function verifyBuildArtifacts(buildPath, requiredFiles = ['index.html']) {
  for (const file of requiredFiles) {
    const exists = await fs.pathExists(path.join(buildPath, file));
    if (!exists) {
      throw new Error(`Required build artifact not found: ${file}`);
    }
  }
}

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

async function createPreview(sitePath, id) {
  try {
    const dirContents = await fs.readdir(sitePath);
    log("Directory contents before build:", dirContents);

    log("Installing dependencies");
    await execAsync("npm install", { cwd: sitePath });

    log("Starting build process");
    try {
      const buildResult = await execAsync("npm run build", { cwd: sitePath });
      log(`Build completed: ${buildResult.stdout}`);
      
      const distPath = path.join(sitePath, "dist");
      const distExists = await fs.pathExists(distPath);
      if (!distExists) {
        throw new Error("Build completed but dist folder not found");
      }
      
      await verifyBuildArtifacts(distPath);
    } catch (buildError) {
      log("Build failed", "error", buildError);
      console.error("Build stderr:", buildError.stderr);
      throw buildError;
    }

    const publicPath = path.join(PUBLIC_DIR, id);
    await fs.ensureDir(publicPath);
    
    const distPath = path.join(sitePath, "dist");
    await fs.copy(distPath, publicPath);
    
    await verifyBuildArtifacts(publicPath);
    log("Public directory contents:", await fs.readdir(publicPath));

    return {
      url: `/preview/${id}`,
      preview_id: id,
    };
  } catch (error) {
    log("Preview creation failed", "error", error);
    throw error;
  }
}

// Template files remain the same as in your original code
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
    <script type="module" src="/src/main.tsx"></script>
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
        build: "tsc && vite build",
        preview: "vite preview",
      },
      dependencies: {
        react: "^18.2.0",
        "react-dom": "^18.2.0",
        "react-router-dom": "^6.21.1",
        "lucide-react": "^0.303.0",
      },
      devDependencies: {
        "@types/react": "^18.2.48",
        "@types/react-dom": "^18.2.18",
        "@vitejs/plugin-react": "^4.2.1",
        typescript: "^5.3.3",
        vite: "^5.0.12",
        autoprefixer: "^10.4.17",
        postcss: "^8.4.33",
        tailwindcss: "^3.4.1",
      },
    },
    null,
    2
  ),

  "postcss.config.js": `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}`,

  "tailwind.config.js": `/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}`,

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
      },
      include: ["src"],
      references: [{ path: "./tsconfig.node.json" }],
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
        allowSyntheticDefaultImports: true,
      },
      include: ["vite.config.ts"],
    },
    null,
    2
  ),

  "vite.config.ts": `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});`,
};

async function initializeBaseTemplate() {
  try {
    log("Initializing base template");
    
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

function debugLog(message) {
  console.log('\n=== DEBUG LOG ===');
  console.log(message);
  console.log('================\n');
}

app.use((req, res, next) => {
  debugLog(`🔍 New Request: ${req.method} ${req.url}`);
  next();
});

app.post("/api/preview/create", async (req, res) => {
  const startTime = Date.now();
  let previewPath = null;
  let publicOutputPath = null;

  try {
    const { id, files, dependencies = [] } = req.body;
    log(`Starting preview creation for ID: ${id}`);

    previewPath = path.join(PREVIEW_DIR, id);
    publicOutputPath = path.join(PUBLIC_DIR, id);
    await fs.ensureDir(previewPath);
    log(`Created preview directory: ${previewPath}`);

    await fs.copy(BASE_TEMPLATE_DIR, previewPath);
    log("Copied template files");

    const createdPaths = [];

    const processFile = async (file, basePath) => {
      const filePath = path.join(basePath, file.path);
      
      if (file.type === "folder") {
        await fs.ensureDir(filePath);
        createdPaths.push(filePath);
        log(`Created folder: ${file.path}`);

        if (file.children && Array.isArray(file.children)) {
          for (const childFile of file.children) {
            await processFile(childFile, basePath);
          }
        }
      } else if (file.type === "file") {
        await fs.ensureDir(path.dirname(filePath));
        
        // Only process content if it exists
        if (file.content !== undefined && file.content !== null) {
          let content = file.content;
          if (typeof content === 'string' && content.startsWith("```")) {
            const lines = content.split("\n");
            content = lines.slice(1, -1).join("\n");
          }
          await fs.writeFile(filePath, content);
          createdPaths.push(filePath);
          log(`Created file: ${file.path}`);
        } else {
          // Create an empty file if no content is provided
          await fs.writeFile(filePath, '');
          createdPaths.push(filePath);
          log(`Created empty file: ${file.path}`);
        }
      }
    };

    // Process all files
    for (const file of files) {
      try {
        await processFile(file, previewPath);
      } catch (error) {
        log(`Failed to process file: ${file.path}`, "error", error);
        throw error;
      }
    }

    if (dependencies.length > 0) {
      await installAdditionalDependencies(previewPath, dependencies);
    }

    const previewResult = await createPreview(previewPath, id);

    // After successful preview creation, cleanup only the preview directory
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      if (previewPath && previewPath !== publicOutputPath && !previewPath.includes(PUBLIC_DIR)) {
        await fs.remove(previewPath);
        log(`Cleaned up preview directory: ${previewPath}`);
      }
    } catch (cleanupError) {
      log(`Warning: Failed to cleanup preview directory: ${previewPath}`, "warn", cleanupError);
    }

    const duration = Date.now() - startTime;
    log(`Preview creation completed in ${duration}ms`, "info", {
      id,
      url: previewResult.url,
      duration,
    });

    res.json(previewResult);
  } catch (error) {
    const duration = Date.now() - startTime;
    log(`Preview creation failed after ${duration}ms`, "error", error);
    
    if (previewPath && previewPath !== publicOutputPath && !previewPath.includes(PUBLIC_DIR)) {
      try {
        await fs.remove(previewPath);
        log(`Cleaned up preview directory after error: ${previewPath}`);
      } catch (cleanupError) {
        log(`Warning: Failed to cleanup preview directory after error: ${previewPath}`, "warn", cleanupError);
      }
    }
    
    res.status(500).json({
      error: error.message,
      details: error.stack,
    });
  }
});

app.get('/preview/:id/*', (req, res) => {
  debugLog('🎯 Preview route hit!');
  const fullPath = path.join(PUBLIC_DIR, req.params.id, 'index.html');
  debugLog(`📂 Looking for file at: ${fullPath}`);
  
  if (fs.existsSync(fullPath)) {
    debugLog('✅ File found! Sending...');
    res.sendFile(fullPath);
  } else {
    debugLog('❌ File not found!');
    res.status(404).json({
      error: 'Not found',
      message: `File not found: ${fullPath}`,
      checkedPath: fullPath
    });
  }
});

app.get('/api/files', async (req, res) => {
  try {
    const publicContents = await fs.readdir(PUBLIC_DIR);
    const files = {};
    
    for (const item of publicContents) {
      const itemPath = path.join(PUBLIC_DIR, item);
      const stats = await fs.stat(itemPath);
      files[item] = {
        isDirectory: stats.isDirectory(),
        size: stats.size,
        contents: stats.isDirectory() ? await fs.readdir(itemPath) : null
      };
    }
    
    res.json({
      PUBLIC_DIR,
      files
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/preview/files/:id', async (req, res) => {
  const { id } = req.params;
  const previewPath = path.join(PUBLIC_DIR, id);
  
  try {
    const exists = await fs.pathExists(previewPath);
    if (!exists) {
      return res.status(404).json({ error: 'Preview not found' });
    }
    
    const files = await fs.readdir(previewPath, { withFileTypes: true });
    const filesInfo = await Promise.all(
      files.map(async (file) => {
        const filePath = path.join(previewPath, file.name);
        const stats = await fs.stat(filePath);
        return {
          name: file.name,
          isDirectory: file.isDirectory(),
          size: stats.size,
          path: filePath
        };
      })
    );
    
    res.json({ files: filesInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/debug/preview/:id', async (req, res) => {
  const { id } = req.params;
  log(id)
  const previewPath = path.join(PUBLIC_DIR, id);
  const indexPath = path.join(previewPath, 'index.html');
  
  try {
    const exists = await fs.pathExists(previewPath);
    const indexExists = await fs.pathExists(indexPath);
    const dirContents = exists ? await fs.readdir(previewPath) : [];
    
    res.json({
      previewPath,
      exists,
      indexExists,
      dirContents,
      PUBLIC_DIR
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/preview/cleanup", async (req, res) => {
  const { id } = req.body;
  try {
    const previewPath = path.join(PUBLIC_DIR, id);
    if (await fs.pathExists(previewPath)) {
      await fs.remove(previewPath);
      log(`Cleaned up public directory for preview: ${id}`);
    }
    res.json({ success: true });
  } catch (error) {
    log("Failed to clean up public directory", "error", error);
    res.status(500).json({ error: error.message });
  }
});

app.use((err, req, res, next) => {
  log("Unhandled error in request", "error", err);
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
    ...(process.env.NODE_ENV === "development" && { stack: err.stack }),
  });
});

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
    message: `Route ${req.method} ${req.path} not found`,
  });
});

initializeBaseTemplate()
  .then(() => {
    const port = 5000;
    app.listen(port, () => {
      log(`Preview server running on port ${port}`);
    });
  })
  .catch((err) => {
    log("Failed to initialize base template", "error", err);
    process.exit(1);
  });

module.exports = app;