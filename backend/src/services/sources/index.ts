/**
 * Sources module — public API.
 *
 * `pollSource` dispatches by source type and implements the `PollSourceFn`
 * contract consumed by the pipeline (queue/pipeline.ts).
 */
import { SOURCE_TYPE, type Source } from '../../db/schema/sources.schema.js';
import type { PollResult, PollSourceFn } from '../../types/contracts.js';
import { AppError, ErrorCodes } from '../../utils/errors.js';
import { pollCollectionEmailSource } from './collectionEmail.js';
import { getValidAccessToken, type DriveFolder } from './common.js';
import { loadOAuthCredentials } from './credentials.js';
import { pollGoogleDriveSource, listGoogleDriveFolders, refreshGoogleToken } from './googleDrive.js';
import { pollImapSource } from './imap.js';
import { pollOneDriveSource, listOneDriveFolders, refreshOneDriveToken } from './oneDrive.js';

/** Poll a source for new files, dispatching by source type. */
export const pollSource: PollSourceFn = async (source: Source, tmpDir: string): Promise<PollResult> => {
  switch (source.type) {
    case SOURCE_TYPE.COLLECTION_EMAIL:
      return pollCollectionEmailSource(source, tmpDir);
    case SOURCE_TYPE.IMAP:
      return pollImapSource(source, tmpDir);
    case SOURCE_TYPE.ONEDRIVE:
      return pollOneDriveSource(source, tmpDir);
    case SOURCE_TYPE.GOOGLE_DRIVE:
      return pollGoogleDriveSource(source, tmpDir);
    default: {
      const unknownType: never = source.type;
      throw new AppError(ErrorCodes.BAD_REQUEST, `Unknown source type: ${String(unknownType)}`, 400);
    }
  }
};

/**
 * List folders of a connected drive source (folder picker). Uses the stored
 * (encrypted) tokens, refreshing them when needed.
 */
export async function listDriveFolders(source: Source, parentId?: string): Promise<DriveFolder[]> {
  if (source.type === SOURCE_TYPE.ONEDRIVE) {
    const creds = (await loadOAuthCredentials(source.companyId, 'onedrive')) ?? undefined;
    const accessToken = await getValidAccessToken(source, (rt) => refreshOneDriveToken(rt, creds));
    return listOneDriveFolders(accessToken, parentId);
  }
  if (source.type === SOURCE_TYPE.GOOGLE_DRIVE) {
    const creds = (await loadOAuthCredentials(source.companyId, 'google_drive')) ?? undefined;
    const accessToken = await getValidAccessToken(source, (rt) => refreshGoogleToken(rt, creds));
    return listGoogleDriveFolders(accessToken, parentId);
  }
  throw new AppError(ErrorCodes.BAD_REQUEST, 'Folder listing is only available for drive sources', 400);
}

// Per-company OAuth app credentials
export {
  loadOAuthCredentials,
  requireOAuthCredentials,
  type OAuthCredentials,
  type DriveProvider,
} from './credentials.js';

// Collection email (app-provisioned mailbox)
export {
  pollCollectionEmailSource,
  provisionCollectionMailbox,
  deprovisionCollectionMailbox,
  isCollectionEmailAvailable,
} from './collectionEmail.js';

// IMAP
export { pollImapSource, testImapConnection, type ImapConnectionConfig } from './imap.js';

// OneDrive
export {
  pollOneDriveSource,
  listOneDriveFolders,
  buildOneDriveAuthUrl,
  exchangeOneDriveCode,
  refreshOneDriveToken,
  getMicrosoftAccountEmail,
  isOneDriveConfigured,
  isOneDriveFileSupported,
} from './oneDrive.js';

// Google Drive
export {
  pollGoogleDriveSource,
  listGoogleDriveFolders,
  buildGoogleAuthUrl,
  exchangeGoogleCode,
  refreshGoogleToken,
  getGoogleAccountEmail,
  isGoogleDriveConfigured,
  isGoogleDriveFileSupported,
} from './googleDrive.js';

// Shared helpers
export {
  getValidAccessToken,
  persistDriveTokens,
  getDriveConfig,
  type DriveFolder,
  type OAuthTokens,
} from './common.js';

// Attachment filter (pure heuristics)
export {
  filterInvoiceAttachments,
  isInvoiceCandidate,
  resolveMimeType,
  mimeTypeForFileName,
  validateMagicNumber,
  SUPPORTED_MIME_TYPES,
  type CandidateAttachment,
} from './attachmentFilter.js';
