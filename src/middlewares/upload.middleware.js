import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import multer from "multer";
import { AppError } from "../utils/app-error.js";

const MAX_TURF_IMAGES = 5;

export const turfUploadDirectory = path.resolve("storage", "venues");
export const tournamentUploadDirectory = path.resolve("storage", "tournaments");
export const teamUploadDirectory = path.resolve("storage", "teams");
mkdirSync(turfUploadDirectory, { recursive: true });
mkdirSync(tournamentUploadDirectory, { recursive: true });
mkdirSync(teamUploadDirectory, { recursive: true });

const imageFileFilter = (_request, file, callback) => {
  if (!file.mimetype.startsWith("image/")) {
    callback(new AppError("Only image files are allowed", 400, "INVALID_IMAGE_TYPE"));
    return;
  }
  callback(null, true);
};

const createImageStorage = (directory) => multer.diskStorage({
  destination: (_request, _file, callback) => callback(null, directory),
  filename: (_request, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${randomUUID()}${extension}`);
  },
});

export const uploadTurfImages = multer({
  storage: createImageStorage(turfUploadDirectory),
  limits: { files: MAX_TURF_IMAGES, fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
}).array("images", MAX_TURF_IMAGES);

export const uploadTournamentCover = multer({
  storage: createImageStorage(tournamentUploadDirectory),
  limits: { files: 1, fileSize: 5 * 1024 * 1024 },
  fileFilter: imageFileFilter,
}).single("cover");

export const uploadTeamLogo = multer({
  storage: createImageStorage(teamUploadDirectory),
  limits: { files: 1, fileSize: 3 * 1024 * 1024 },
  fileFilter: imageFileFilter,
}).single("logo");
