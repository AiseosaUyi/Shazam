import { googleFetch } from './oauth';

const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary';

export async function listCalendarEvents(userId: string, timeMin: string, timeMax: string, max = 25) {
  const data = await googleFetch(userId, `${CAL}/events?${new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: String(max) })}`);
  return (data.items || []).map((e: any) => ({
    id: e.id,
    summary: e.summary || '(no title)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    attendees: (e.attendees || []).map((a: any) => a.email),
    link: e.htmlLink,
  }));
}

export async function createCalendarEvent(userId: string, ev: { summary: string; description?: string; start: string; end: string; timeZone?: string; attendees?: string[]; addMeet?: boolean }) {
  const body: any = {
    summary: ev.summary,
    description: ev.description,
    start: { dateTime: ev.start, timeZone: ev.timeZone },
    end: { dateTime: ev.end, timeZone: ev.timeZone },
    attendees: (ev.attendees || []).map((email) => ({ email })),
  };
  if (ev.addMeet) body.conferenceData = { createRequest: { requestId: crypto.randomUUID() } };
  const data = await googleFetch(userId, `${CAL}/events?conferenceDataVersion=${ev.addMeet ? 1 : 0}&sendUpdates=all`, { method: 'POST', body: JSON.stringify(body) });
  return { id: data.id, link: data.htmlLink, meet: data.hangoutLink || null };
}
