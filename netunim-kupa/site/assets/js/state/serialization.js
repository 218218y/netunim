

export function payloadFromState(snapshot,revision){const {_meta,...clean}=snapshot||{};return {_meta:{format:'kupa-portable',schemaVersion:6,revision,savedAt:new Date().toISOString(),app:'ניהול קופה ניידת'},...clean}}

export function comparableBackupPayload(payload){const {_meta,...raw}=payload||{};return JSON.stringify(raw)}
