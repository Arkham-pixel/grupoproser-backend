import mongoose from 'mongoose';
import { DOCUMENT_TYPE_KEYS } from '../config/claimDocumentTypes.js';

const SOURCE_MODULES = ['complex', 'express', 'alfa', 'zurich', 'bbva-cat', 'allianz', 'allias', 'previsora', 'puertos', 'other'];
const SYNC_STATUSES = ['pending', 'syncing', 'synced', 'failed', 'disabled'];
const DOC_STATUSES = ['active', 'deleted', 'archived'];

/**
 * Metadatos de documentos de siniestro (S3 = verdad; SharePoint = réplica).
 * Relación polimórfica: sourceModule + claimId (sin ref a un único modelo de caso).
 * uploadedBy → SecurUser (auth principal ARNALD), no el legacy Usuario.
 */
const ClaimDocumentSchema = new mongoose.Schema(
  {
    sourceModule: {
      type: String,
      required: true,
      enum: SOURCE_MODULES,
      index: true,
    },

    claimId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
      // Sin ref: el caso vive en colecciones distintas según sourceModule
    },

    claimNumber: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    /**
     * Origen del claimNumber usado en la ruta SharePoint.
     * Alfa: "siniestro" | "consecutivo". Otros módulos pueden omitirlo.
     */
    claimNumberSource: {
      type: String,
      enum: ['siniestro', 'consecutivo', 'identificacion_poliza', 'other'],
      trim: true,
    },

    /**
     * Destino SharePoint Alfa: SEGUROS ALFA/SINIESTROS/{cedula}/{SUBCARPETA}.
     * pending_destination = falta cédula; no crear carpeta inválida.
     */
    destinationStatus: {
      type: String,
      enum: ['ready', 'pending_destination'],
      default: 'ready',
      index: true,
    },
    destinationReason: {
      type: String,
      trim: true,
    },

    /** Snapshot para builder Alfa (id + póliza). */
    alfaIdentificacion: {
      type: String,
      trim: true,
      index: true,
    },
    alfaNumeroPoliza: {
      type: String,
      trim: true,
    },

    insurer: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    documentType: {
      type: String,
      required: true,
      enum: DOCUMENT_TYPE_KEYS,
      index: true,
    },

    originalName: {
      type: String,
      required: true,
      trim: true,
    },

    storedName: {
      type: String,
      trim: true,
    },

    mimeType: String,

    size: Number,

    checksum: {
      algorithm: {
        type: String,
        default: 'sha256',
      },
      value: String,
    },

    storage: {
      provider: {
        type: String,
        enum: ['s3'],
        default: 's3',
      },
      bucket: {
        type: String,
        required: true,
      },
      key: {
        type: String,
        required: true,
      },
      etag: String,
    },

    sharepoint: {
      enabled: {
        type: Boolean,
        default: true,
      },
      syncStatus: {
        type: String,
        enum: SYNC_STATUSES,
        default: 'pending',
      },
      siteId: String,
      driveId: String,
      itemId: String,
      parentItemId: String,
      path: String,
      webUrl: String,
      attempts: {
        type: Number,
        default: 0,
      },
      lastAttemptAt: Date,
      nextRetryAt: Date,
      syncedAt: Date,
      lastError: {
        code: String,
        message: String,
        status: Number,
      },
    },

    integrationKey: {
      type: String,
      trim: true,
      index: true,
    },

    /** Auth real de ARNALD */
    uploadedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SecurUser',
    },

    /** Snapshot para listados sin join (patrón similar a Documento.usuarioSubio) */
    uploadedByLogin: String,
    uploadedByName: String,

    status: {
      type: String,
      enum: DOC_STATUSES,
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'claim_documents',
  }
);

ClaimDocumentSchema.index({ claimId: 1, status: 1 });
ClaimDocumentSchema.index({ sourceModule: 1, claimId: 1 });
ClaimDocumentSchema.index({ 'sharepoint.syncStatus': 1, 'sharepoint.nextRetryAt': 1 });
ClaimDocumentSchema.index({ 'storage.bucket': 1, 'storage.key': 1 });
ClaimDocumentSchema.index({ 'sharepoint.itemId': 1 });
// Unique sparse: solo documentos con integrationKey (piloto Alfa+)
ClaimDocumentSchema.index(
  { integrationKey: 1 },
  { unique: true, sparse: true, name: 'integrationKey_1_unique_sparse' }
);

export const CLAIM_DOCUMENT_SOURCE_MODULES = SOURCE_MODULES;
export const CLAIM_DOCUMENT_SYNC_STATUSES = SYNC_STATUSES;

const ClaimDocument =
  mongoose.models.ClaimDocument ||
  mongoose.model('ClaimDocument', ClaimDocumentSchema);

export default ClaimDocument;
