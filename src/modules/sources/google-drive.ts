import fs from 'fs';
import { logger } from '../../utils/logger';
import { config } from '../../config';

// Google Drive source ingestion module
// Uses Google Drive API v3 via service account or user credentials

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  content: string;
}

export function parseDriveUri(uri: string): { fileId: string; type: 'doc' | 'sheet' | 'file' } {
  // Formats: docs.google.com/document/d/FILE_ID, drive.google.com/file/d/FILE_ID, raw FILE_ID
  let fileId = uri;
  let type: 'doc' | 'sheet' | 'file' = 'file';

  if (uri.includes('docs.google.com/document')) {
    const match = uri.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) fileId = match[1];
    type = 'doc';
  } else if (uri.includes('docs.google.com/spreadsheets')) {
    const match = uri.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) fileId = match[1];
    type = 'sheet';
  } else if (uri.includes('drive.google.com/file')) {
    const match = uri.match(/\/d\/([a-zA-Z0-9_-]+)/);
    if (match) fileId = match[1];
  }

  return { fileId, type };
}

export async function fetchDriveFile(fileId: string, accessToken: string): Promise<DriveFile> {
  // Export Google Docs as plain text, Sheets as CSV
  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,mimeType`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!metaRes.ok) {
    const status = metaRes.status;
    if (status === 401 || status === 403) {
      throw new Error(`Drive authentication failed (${status}). Re-auth required.`);
    }
    throw new Error(`Failed to get file metadata: ${status}`);
  }

  const meta = await metaRes.json() as { id: string; name: string; mimeType: string };

  let content: string;
  if (meta.mimeType === 'application/vnd.google-apps.document') {
    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/plain`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    content = await exportRes.text();
  } else if (meta.mimeType === 'application/vnd.google-apps.spreadsheet') {
    const exportRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}/export?mimeType=text/csv`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    content = await exportRes.text();
  } else {
    // Binary or other — download as text
    const downloadRes = await fetch(
      `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    content = await downloadRes.text();
  }

  return { id: meta.id, name: meta.name, mimeType: meta.mimeType, content };
}

export async function listDriveFolder(
  folderId: string,
  accessToken: string
): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q='${folderId}'+in+parents+and+trashed+=+false&fields=files(id,name,mimeType)&orderBy=name&pageSize=100`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) throw new Error(`Failed to list Drive folder: ${res.status}`);
  const data = await res.json() as { files: Array<{ id: string; name: string; mimeType: string }> };
  return data.files;
}

export async function listDriveFolders(
  parentId: string,
  accessToken: string
): Promise<Array<{ id: string; name: string }>> {
  const q = encodeURIComponent(`'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`);
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=100&fields=files(id,name)&orderBy=name`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) throw new Error(`Failed to list Drive folders: ${res.status}`);
  const data = await res.json() as { files: Array<{ id: string; name: string }> };
  return data.files;
}

// List the Google Sheets *and* sub-folders inside a Drive folder. Used by the
// Database feature's sheet picker so admins can drill down to a specific
// spreadsheet without leaving the dashboard. Folders are returned alongside
// sheets so the same panel handles navigation and selection.
export async function listDriveSpreadsheets(
  parentId: string,
  accessToken: string,
): Promise<{
  folders: Array<{ id: string; name: string }>;
  sheets: Array<{ id: string; name: string; modifiedTime?: string }>;
}> {
  const q = encodeURIComponent(
    `'${parentId}' in parents and ` +
    `(mimeType = 'application/vnd.google-apps.folder' or mimeType = 'application/vnd.google-apps.spreadsheet') ` +
    `and trashed = false`,
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=200&fields=files(id,name,mimeType,modifiedTime)&orderBy=folder,name`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) throw new Error(`Failed to list Drive contents: ${res.status}`);
  const data = await res.json() as {
    files: Array<{ id: string; name: string; mimeType: string; modifiedTime?: string }>;
  };
  const folders = data.files
    .filter(f => f.mimeType === 'application/vnd.google-apps.folder')
    .map(f => ({ id: f.id, name: f.name }));
  const sheets = data.files
    .filter(f => f.mimeType === 'application/vnd.google-apps.spreadsheet')
    .map(f => ({ id: f.id, name: f.name, modifiedTime: f.modifiedTime }));
  return { folders, sheets };
}

// ── Write-Back for Document Filling (Module 14) ──

export async function writeGoogleSheet(
  sheetId: string,
  range: string,
  values: string[][],
  accessToken: string
): Promise<void> {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/${range}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ values }),
    }
  );

  if (!res.ok) throw new Error(`Failed to write Google Sheet: ${res.status}`);
  logger.info('Google Sheet updated', { sheetId, range });
}

export async function replaceGoogleDocTokens(
  docId: string,
  replacements: Record<string, string>,
  accessToken: string
): Promise<void> {
  const requests = Object.entries(replacements).map(([placeholder, value]) => ({
    replaceAllText: {
      containsText: { text: `{{${placeholder}}}`, matchCase: true },
      replaceText: value,
    },
  }));

  const res = await fetch(
    `https://docs.googleapis.com/v1/documents/${docId}:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requests }),
    }
  );

  if (!res.ok) throw new Error(`Failed to update Google Doc: ${res.status}`);
  logger.info('Google Doc updated', { docId, replacements: Object.keys(replacements).length });
}

// ── Service Account Auth ──

export async function getServiceAccountToken(): Promise<string | null> {
  const keyPath = config.google.serviceAccountKeyPath;
  if (!keyPath || !fs.existsSync(keyPath)) return null;

  // In production, use google-auth-library to generate JWT and exchange for access token.
  // For now, return null to indicate Drive is not configured.
  logger.warn('Google Drive service account configured but JWT exchange not implemented. Use google-auth-library.');
  return null;
}
