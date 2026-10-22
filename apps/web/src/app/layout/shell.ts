import {
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AdminPendingService } from '../core/admin-pending.service';
import { AiAvailability } from '../core/ai-availability.service';
import { AuthService } from '../core/auth.service';
import { CaptureService } from '../core/capture.service';
import { KeyboardPrimer } from '../core/keyboard-primer';
import { KeyboardService } from '../core/keyboard.service';
import { NetworkService } from '../core/network.service';
import { BottomSheet } from '../shared/ui/bottom-sheet';
import { Icon, type IconName } from '../shared/ui/icon';

interface NavTab {
  path: string;
  label: string;
  icon: IconName;
}

export const LONG_PRESS_MS = 450;
export const LOG_WEIGHT_PATH = '/today?weight=1';
export const LOG_WEIGHT_PRIME_MS = 8000;
export const SETTINGS_TAB_PATH = '/settings';
export const COMPARE_PATH = '/compare';
export const MEAL_IDEAS_PATH = '/today?ideas=1';
export const FOOD_DATABASE_PATH = '/foods';

export function demoBannerText(expiresAt: string | null, now: number = Date.now()): string | null {
  if (!expiresAt) {
    return null;
  }
  const hours = Math.max(1, Math.ceil((Date.parse(expiresAt) - now) / 3_600_000));
  const left = hours === 1 ? 'about an hour' : `${hours} hours`;
  return `Demo sandbox · deleted in ${left} · AI estimates are simulated`;
}

const NAV_TABS: readonly NavTab[] = [
  { path: '/today', label: 'Today', icon: 'home' },
  { path: '/stats', label: 'Stats', icon: 'chart' },
  { path: '/history', label: 'History', icon: 'history' },
  { path: SETTINGS_TAB_PATH, label: 'Settings', icon: 'settings' },
];

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, BottomSheet],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
})
export class Shell {
  private readonly capture = inject(CaptureService);
  private readonly router = inject(Router);
  private readonly keyboardPrimer = inject(KeyboardPrimer);
  private readonly cameraInput = viewChild.required<ElementRef<HTMLInputElement>>('cameraInput');
  private readonly libraryInput = viewChild.required<ElementRef<HTMLInputElement>>('libraryInput');
  private readonly actionSheet = viewChild.required(BottomSheet);
  private pressTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressed = false;

  protected readonly online = inject(NetworkService).online;
  protected readonly keyboardOpen = inject(KeyboardService).open;
  protected readonly tabs = NAV_TABS;
  protected readonly settingsPath = SETTINGS_TAB_PATH;
  protected readonly pendingAccess = inject(AdminPendingService).count;
  protected readonly pendingAccessLabel = computed(() => {
    const count = this.pendingAccess();
    return count === 1 ? '1 access request waiting' : `${count} access requests waiting`;
  });
  protected readonly actionsOpen = signal(false);
  protected readonly ai = inject(AiAvailability);
  private readonly auth = inject(AuthService);
  protected readonly demoNote = computed(() => demoBannerText(this.auth.demo()?.expiresAt ?? null));

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const detach = this.capture.attachInputs({
        camera: this.cameraInput().nativeElement,
        library: this.libraryInput().nativeElement,
      });
      destroyRef.onDestroy(detach);
    });
    destroyRef.onDestroy(() => this.cancelPress());
  }

  protected onFabPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    this.longPressed = false;
    this.cancelPress();
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      this.longPressed = true;
      navigator.vibrate?.(12);
      this.actionsOpen.set(true);
    }, LONG_PRESS_MS);
  }

  protected cancelPress(): void {
    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
  }

  protected onFabClick(): void {
    this.cancelPress();
    if (this.longPressed) {
      this.longPressed = false;
      return;
    }
    if (this.ai.enabled()) {
      this.capture.requestCamera('food_photo');
    } else {
      this.keyboardPrimer.prime();
      this.capture.openSearch();
    }
  }

  protected onActionsClosed(): void {
    this.longPressed = false;
  }

  protected openActions(): void {
    this.actionsOpen.set(true);
  }

  protected searchFoods(): void {
    this.actionSheet().close();
    this.keyboardPrimer.prime();
    this.capture.openSearch();
  }

  protected openFoodDatabase(): void {
    this.actionSheet().close();
    void this.router.navigateByUrl(FOOD_DATABASE_PATH);
  }

  protected compareOptions(): void {
    this.actionSheet().close();
    void this.router.navigateByUrl(COMPARE_PATH);
  }

  protected mealIdeas(): void {
    this.actionSheet().close();
    void this.router.navigateByUrl(MEAL_IDEAS_PATH);
  }

  protected scanBarcode(): void {
    this.actionSheet().close();
    this.capture.requestBarcode();
  }

  protected takeFoodPhoto(): void {
    this.actionSheet().close();
    this.capture.requestCamera('food_photo');
  }

  protected chooseFromLibrary(): void {
    this.actionSheet().close();
    this.capture.requestLibrary('food_photo');
  }

  protected scanLabel(): void {
    this.actionSheet().close();
    this.capture.requestCamera('nutrition_label');
  }

  protected describeFood(): void {
    this.actionSheet().close();
    this.keyboardPrimer.prime();
    this.capture.startText();
  }

  protected logWeight(): void {
    this.actionSheet().close();
    this.keyboardPrimer.prime(LOG_WEIGHT_PRIME_MS);
    void this.router.navigateByUrl(LOG_WEIGHT_PATH);
  }

  protected openFavorites(): void {
    this.actionSheet().close();
    void this.router.navigateByUrl('/favorites');
  }
}
