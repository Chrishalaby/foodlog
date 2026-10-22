import type { CameraErrorKind } from './camera';

export interface ScannerProblem {
  title: string;
  message: string;
  retry: boolean;
}

export const CAMERA_PROBLEMS: Record<CameraErrorKind, ScannerProblem> = {
  insecure: {
    title: 'The camera needs a secure connection',
    message:
      'Open FoodLog over https to scan live. You can still type the number or take a photo of the barcode.',
    retry: false,
  },
  unsupported: {
    title: "This browser can't use the camera here",
    message: 'Type the number under the barcode, or take a photo of it instead.',
    retry: false,
  },
  denied: {
    title: 'Camera access is off',
    message:
      'Allow camera access for FoodLog in your browser or phone settings, then try again. Or use one of the options below.',
    retry: true,
  },
  'no-camera': {
    title: 'No camera found',
    message: 'Type the number under the barcode, or take a photo of it instead.',
    retry: false,
  },
  'in-use': {
    title: 'The camera is busy',
    message: 'Another app may be using it. Close it and try again.',
    retry: true,
  },
  unknown: {
    title: "Couldn't start the camera",
    message: 'Try again, or use one of the options below.',
    retry: true,
  },
};

export const READER_PROBLEM: ScannerProblem = {
  title: "Barcode scanning isn't available",
  message: "The scanner couldn't load. Check your connection and try again, or type the number.",
  retry: true,
};

export const NO_BARCODE_IN_PHOTO =
  'No barcode found in that photo. Try one where the barcode or QR code fills the frame.';
export const NO_PRODUCT_IN_QR = 'No product code in this QR. Try the barcode on the pack instead.';
export const PHOTO_UNREADABLE = "Couldn't read that photo. Try another one.";
export const CODE_READER_UNAVAILABLE =
  "The code reader couldn't load. Check your connection and try again.";
export const QR_WITHOUT_PRODUCT_HINT = 'No product code in this QR. Try the barcode';
