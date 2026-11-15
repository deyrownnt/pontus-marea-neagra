import { participants as baseParticipants } from './data.js';

export const PARTICIPANTS_STORAGE_KEY = 'pontus-participants-v1';

export function normalizeParticipantName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('ro')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function cleanParticipant(item, locked = false) {
  return {
    id: String(item?.id || `added-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 100),
    name: String(item?.name || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    contribution: String(item?.contribution || '').trim().replace(/\s+/g, ' ').slice(0, 120),
    locked: locked || Boolean(item?.locked)
  };
}

export function readParticipantRoster() {
  const base = baseParticipants.map(item => cleanParticipant(item, true)).filter(item => item.name);
  const seen = new Set(base.map(item => normalizeParticipantName(item.name)));
  let extras = [];
  try {
    const raw = JSON.parse(localStorage.getItem(PARTICIPANTS_STORAGE_KEY) || '[]');
    if (Array.isArray(raw)) {
      extras = raw.slice(0, 100).map(item => cleanParticipant(item, false)).filter(item => {
        const key = normalizeParticipantName(item.name);
        if (item.name.length < 3 || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
  } catch (error) {
    console.info('Lista locală a participanților nu a putut fi citită.', error);
  }
  return { base, extras, all: [...base, ...extras] };
}

export function saveParticipantExtras(extras) {
  try {
    localStorage.setItem(PARTICIPANTS_STORAGE_KEY, JSON.stringify(extras.map(({ id, name, contribution }) => ({ id, name, contribution }))));
    return true;
  } catch (error) {
    console.info('Lista participanților nu a putut fi salvată local.', error);
    return false;
  }
}
