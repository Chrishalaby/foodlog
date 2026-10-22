import { DOCUMENT, Injectable, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { type RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { NOTES_IDENTITY, isNotesHost, isNotesUrl } from './app-identity.service';

export const APP_NAME = 'FoodLog';

export function documentTitle(
  url: string,
  pageTitle: string | undefined,
  appName: string = APP_NAME,
): string {
  if (isNotesUrl(url)) {
    return NOTES_IDENTITY.name;
  }
  return pageTitle ? `${pageTitle} · ${appName}` : appName;
}

@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private readonly appName = isNotesHost(inject(DOCUMENT).location?.hostname)
    ? NOTES_IDENTITY.name
    : APP_NAME;

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.title.setTitle(documentTitle(snapshot.url, this.buildTitle(snapshot), this.appName));
  }
}
