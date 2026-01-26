import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config';
import { AppError } from './errorHandler';

// Ensure upload directory exists
const uploadDir = path.resolve(config.upload.directory);
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Create subdirectories for different file types
const subdirs = ['invoices', 'receipts', 'documents', 'temp'];
subdirs.forEach((subdir) => {
  const dir = path.join(uploadDir, subdir);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const type = (req.query.type as string) || 'documents';
    const dest = path.join(uploadDir, type);
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const uniqueId = uuidv4();
    const ext = path.extname(file.originalname);
    const safeName = file.originalname
      .replace(ext, '')
      .replace(/[^a-zA-Z0-9]/g, '_')
      .substring(0, 50);
    cb(null, `${Date.now()}-${uniqueId}-${safeName}${ext}`);
  },
});

// File filter
const fileFilter = (
  req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  if (config.upload.allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new AppError(`File type ${file.mimetype} is not allowed`, 400));
  }
};

// Create multer instance
export const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: config.upload.maxFileSize,
  },
});

// Single file upload middleware
export const uploadSingle = (fieldName: string) => upload.single(fieldName);

// Multiple files upload middleware
export const uploadMultiple = (fieldName: string, maxCount: number = 10) =>
  upload.array(fieldName, maxCount);

// Delete file utility
export async function deleteFile(filePath: string): Promise<void> {
  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(uploadDir, filePath);

    if (fs.existsSync(absolutePath)) {
      fs.unlinkSync(absolutePath);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
}

// Get file path utility
export function getFilePath(relativePath: string): string {
  return path.join(uploadDir, relativePath);
}

// Move file from temp to permanent location
export async function moveFile(
  tempPath: string,
  destination: string
): Promise<string> {
  const destDir = path.join(uploadDir, destination);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  const fileName = path.basename(tempPath);
  const newPath = path.join(destDir, fileName);

  fs.renameSync(tempPath, newPath);
  return path.join(destination, fileName);
}
