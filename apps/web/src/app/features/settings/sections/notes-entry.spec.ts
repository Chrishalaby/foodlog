import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NOTES_ENTRY_PATH, NotesEntry } from './notes-entry';

describe('NotesEntry', () => {
  it('links to Notes and says it installs as its own app', async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    const fixture = TestBed.createComponent(NotesEntry);
    await fixture.whenStable();
    const link = (fixture.nativeElement as HTMLElement).querySelector('a')!;
    expect(NOTES_ENTRY_PATH).toBe('/notes');
    expect(link.getAttribute('href')).toBe('/notes');
    expect(link.textContent?.replace(/\s+/g, ' ')).toContain('Notes');
    expect(link.textContent?.replace(/\s+/g, ' ')).toContain(
      'Notes to self with photos and voice. Install it as its own app.',
    );
    expect(link.classList.contains('min-h-16')).toBe(true);
  });
});
