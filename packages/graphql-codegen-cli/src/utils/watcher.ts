import { executeCodegen } from '../codegen';
import { FileOutput, getLogger, Types } from 'graphql-codegen-core';
import { normalizeInstanceOrArray, normalizeOutputParam } from '../helpers';
import isValidPath = require('is-valid-path');
import * as isGlob from 'is-glob';
import * as logSymbols from 'log-symbols';

function log(msg: string) {
  // double spaces to inline the message with Listr
  getLogger().info(`  ${msg}`);
}

function emitWatching() {
  log(`${logSymbols.info} Watching for changes...`);
}

export const createWatcher = (config: Types.Config, onNext: (result: FileOutput[]) => Promise<FileOutput[]>) => {
  const files: string[] = [];
  const documents = normalizeInstanceOrArray<Types.OperationDocument>(config.documents);
  const schemas = normalizeInstanceOrArray<Types.Schema>(config.schema);

  // Add schemas and documents from "generates"
  Object.keys(config.generates)
    .map(filename => normalizeOutputParam(config.generates[filename]))
    .forEach(conf => {
      schemas.push(...normalizeInstanceOrArray<Types.Schema>(conf.schema));
      documents.push(...normalizeInstanceOrArray<Types.OperationDocument>(conf.documents));
    });

  if (documents) {
    documents.forEach(doc => {
      if (typeof doc === 'string') {
        files.push(doc);
      } else {
        files.push(...Object.keys(doc));
      }
    });
  }

  schemas.forEach((schema: string) => {
    if (isGlob(schema) || isValidPath(schema)) {
      files.push(schema);
    }
  });

  let watcher: any;

  const runWatcher = async () => {
    const chokidar = require('chokidar');
    emitWatching();

    watcher = chokidar.watch(files, {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: true,
      cwd: process.cwd(),
      disableGlobbing: false,
      usePolling: true,
      interval: 100,
      binaryInterval: 300,
      depth: 99,
      awaitWriteFinish: true,
      ignorePermissionErrors: false,
      atomic: true
    });

    let isShutdown = false;
    const shutdown = async () => {
      isShutdown = true;
      log(`Shutting down watch...`);
      watcher.close();
    };

    // it doesn't matter what has changed, need to run whole process anyway
    watcher.on('all', () => {
      if (!isShutdown) {
        executeCodegen(config)
          .then(onNext, () => Promise.resolve())
          .then(() => emitWatching());
      }
    });

    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  };

  // the promise never resolves to keep process running
  return new Promise((_, reject) => {
    executeCodegen(config)
      .then(onNext, () => Promise.resolve())
      .then(runWatcher)
      .catch(err => {
        watcher.close();
        reject(err);
      });
  });
};
