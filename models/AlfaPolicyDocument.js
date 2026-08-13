import mongoose from 'mongoose';

const ASSOCIATION_STATUSES = ['matched', 'unmatched', 'ambiguous', 'error'];
const DOC_STATUSES = ['active', 'deleted'];
const IMPORT_STATUSES = ['imported', 'error', 'skipped'];
const SOURCE_IDENTIFIER_TYPES = ['identificacion'];

/**
 * Póliza Alfa importada SharePoint → S3.
 * Independiente de ClaimDocument (réplica saliente).
 *
 * Carpeta SharePoint: SEGUROS ALFA/PÓLIZAS/{IDENTIFICACION}/
 * → sourceIdentifier = identificación (no es numeroPoliza).
 * 1 archivo SharePoint → 1 copia S3 → 0..N casos SegurosAlfaCaso.
 */
const AlfaPolicyDocumentSchema = new mongoose.Schema(
  {
    integrationKey: {
      type: String,
      required: true,
      trim: true,
    },

    source: {
      type: String,
      enum: ['sharepoint'],
      default: 'sharepoint',
    },

    sourceModule: {
      type: String,
      enum: ['alfa'],
      default: 'alfa',
      index: true,
    },

    documentType: {
      type: String,
      enum: [
        'poliza',
        'general',
        'inspeccion',
        'fotografia',
        'informe',
        'liquidacion',
        'otro',
      ],
      default: 'poliza',
    },

    /**
     * Identificador de origen SharePoint (nombre de carpeta bajo PÓLIZAS).
     * Para esta fuente: identificación del asegurado.
     */
    sourceIdentifier: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    sourceIdentifierType: {
      type: String,
      enum: SOURCE_IDENTIFIER_TYPES,
      default: 'identificacion',
      required: true,
      index: true,
    },

    /**
     * Número de póliza real cuando está disponible (p. ej. tras match/Excel).
     * Nunca se rellena con el nombre de carpeta de identificación.
     */
    policyNumber: {
      type: String,
      default: null,
      trim: true,
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

    sharepoint: {
      siteId: String,
      driveId: String,
      itemId: String,
      parentItemId: String,
      path: String,
      webUrl: String,
      eTag: String,
      previousEtag: String,
      lastModifiedDateTime: Date,
      lastVersionAt: Date,
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

    association: {
      status: {
        type: String,
        enum: ASSOCIATION_STATUSES,
        default: 'unmatched',
        index: true,
      },
      alfaCaseIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'SegurosAlfaCaso',
        },
      ],
      /** Candidatos cuando status = ambiguous (sin elegir automáticamente). */
      candidateCaseIds: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'SegurosAlfaCaso',
        },
      ],
      matchedBy: {
        type: String,
        enum: [
          'identificacion',
          'identificacion_poliza',
          'identificacion_refuerzo',
          'identificacion_multi',
        ],
      },
      matchedAt: Date,
      lastMatchAttemptAt: Date,
    },

    importStatus: {
      type: String,
      enum: IMPORT_STATUSES,
      default: 'imported',
      index: true,
    },

    lastError: {
      code: String,
      message: String,
    },

    importAttempts: {
      type: Number,
      default: 0,
    },

    importedAt: Date,

    sourceDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    status: {
      type: String,
      enum: DOC_STATUSES,
      default: 'active',
      index: true,
    },
  },
  {
    timestamps: true,
    collection: 'alfa_policy_documents',
  }
);

AlfaPolicyDocumentSchema.index(
  { integrationKey: 1 },
  { unique: true, name: 'alfa_policy_integrationKey_unique' }
);
AlfaPolicyDocumentSchema.index({
  sourceIdentifier: 1,
  sourceIdentifierType: 1,
  status: 1,
});
AlfaPolicyDocumentSchema.index({ policyNumber: 1, status: 1 });
AlfaPolicyDocumentSchema.index({
  'association.status': 1,
  status: 1,
});
AlfaPolicyDocumentSchema.index({ 'storage.bucket': 1, 'storage.key': 1 });
AlfaPolicyDocumentSchema.index({ 'sharepoint.itemId': 1 });
AlfaPolicyDocumentSchema.index({ 'association.alfaCaseIds': 1 });
AlfaPolicyDocumentSchema.index({ 'association.candidateCaseIds': 1 });

export const ALFA_POLICY_ASSOCIATION_STATUSES = ASSOCIATION_STATUSES;
export const ALFA_POLICY_DOC_STATUSES = DOC_STATUSES;
export const ALFA_POLICY_SOURCE_IDENTIFIER_TYPES = SOURCE_IDENTIFIER_TYPES;

const AlfaPolicyDocument =
  mongoose.models.AlfaPolicyDocument ||
  mongoose.model('AlfaPolicyDocument', AlfaPolicyDocumentSchema);

export default AlfaPolicyDocument;
