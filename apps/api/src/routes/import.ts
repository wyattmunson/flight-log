import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { ImportCommitSchema } from '@flight-log/shared';
import { listBatches, undoBatch } from '../dal/imports';
import { env } from '../env';
import { AppError, badRequest, notFound } from '../http/errors';
import { route } from '../http/route';
import { buildPreview, commitPreview } from '../import/service';

// Browsers report CSVs inconsistently (Excel on Windows says vnd.ms-excel), so accept the
// common text/CSV types but require a .csv extension.
const ALLOWED_MIME = new Set([
  'text/csv',
  'application/csv',
  'text/comma-separated-values',
  'text/plain',
  'application/vnd.ms-excel',
  'application/octet-stream',
  '',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext !== '.csv' || !ALLOWED_MIME.has(file.mimetype)) {
      cb(new AppError(415, 'unsupported_file', 'Please upload a .csv file'));
      return;
    }
    cb(null, true);
  },
});

export const importRouter = Router();

importRouter.post(
  '/preview',
  upload.single('file'),
  route(async (req, res) => {
    if (!req.file) throw badRequest('Attach the CSV as multipart field "file"');
    res.json(await buildPreview(req.userId, req.file));
  }),
);

importRouter.post(
  '/commit',
  route(async (req, res) => {
    const { previewId } = ImportCommitSchema.parse(req.body);
    res.status(201).json(await commitPreview(req.userId, previewId));
  }),
);

importRouter.get(
  '/batches',
  route(async (req, res) => {
    res.json(await listBatches(req.userId));
  }),
);

importRouter.delete(
  '/batches/:id',
  route(async (req, res) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = await undoBatch(req.userId, id);
    if (!result) throw notFound('Import batch');
    res.json(result);
  }),
);
