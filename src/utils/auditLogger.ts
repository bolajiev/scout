import { InferenceLog } from '../types';
import { addInferenceLog, getInferenceLogs } from './storage';
import * as Device from 'expo-device';

export async function logInference(
  useCase: string,
  modelName: string,
  ttftMs: number,
  totalMs: number,
  tokensPredicted: number,
): Promise<void> {
  const tokensPerSec = totalMs > 0 ? Math.round((tokensPredicted / totalMs) * 1000 * 10) / 10 : 0;
  const log: InferenceLog = {
    timestamp: new Date().toISOString(),
    useCase,
    modelName,
    ttftMs,
    totalMs,
    tokensPredicted,
    tokensPerSec,
    deviceModel: Device.modelName || 'unknown',
    deviceBrand: Device.brand || 'unknown',
  };
  await addInferenceLog(log);
}

export function logsToCSV(logs: InferenceLog[]): string {
  const headers = [
    'timestamp', 'useCase', 'modelName',
    'ttftMs', 'totalMs', 'tokensPredicted', 'tokensPerSec',
    'deviceModel', 'deviceBrand',
  ];
  const rows = logs.map(l =>
    [
      l.timestamp, l.useCase, l.modelName,
      l.ttftMs, l.totalMs, l.tokensPredicted, l.tokensPerSec,
      l.deviceModel, l.deviceBrand,
    ].join(',')
  );
  return [headers.join(','), ...rows].join('\n');
}

export function logsToJSON(logs: InferenceLog[]): string {
  return JSON.stringify(logs, null, 2);
}

export { getInferenceLogs };
