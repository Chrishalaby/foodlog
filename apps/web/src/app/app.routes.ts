import type { Routes } from '@angular/router';
import {
  accountLinkGuard,
  adminGuard,
  authGuard,
  guestGuard,
  notesEnabledGuard,
  notesHostGuard,
  onboardingGuard,
  setupGuard,
} from './core/guards';
import { unsavedChangesGuard } from './features/log/unsaved-changes.guard';
import { Shell } from './layout/shell';

export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    canActivate: [guestGuard],
    loadComponent: () => import('./features/auth/login-page').then((m) => m.LoginPage),
  },
  {
    path: 'setup',
    title: 'Set up',
    canActivate: [setupGuard],
    loadComponent: () => import('./features/auth/setup-page').then((m) => m.SetupPage),
  },
  {
    path: 'request-access',
    title: 'Request access',
    canActivate: [guestGuard],
    loadComponent: () =>
      import('./features/auth/request-access-page').then((m) => m.RequestAccessPage),
  },
  {
    path: 'invite/:token',
    title: 'Join FoodLog',
    canActivate: [accountLinkGuard],
    data: { mode: 'invite' },
    loadComponent: () => import('./features/auth/auth-token-page').then((m) => m.AuthTokenPage),
  },
  {
    path: 'reset/:token',
    title: 'Reset password',
    canActivate: [accountLinkGuard],
    data: { mode: 'reset' },
    loadComponent: () => import('./features/auth/auth-token-page').then((m) => m.AuthTokenPage),
  },
  {
    path: 'onboarding',
    title: 'Welcome',
    canActivate: [notesHostGuard, authGuard],
    loadComponent: () =>
      import('./features/onboarding/onboarding-page').then((m) => m.OnboardingPage),
  },
  {
    path: 'notes',
    title: 'Notes',
    canActivate: [authGuard, notesEnabledGuard],
    loadComponent: () => import('./features/notes/notes-page').then((m) => m.NotesPage),
  },
  {
    path: '',
    component: Shell,
    canActivate: [notesHostGuard, authGuard],
    canActivateChild: [onboardingGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'today' },
      {
        path: 'today',
        title: 'Today',
        loadComponent: () => import('./features/today/today-page').then((m) => m.TodayPage),
      },
      {
        path: 'stats',
        title: 'Stats',
        loadComponent: () => import('./features/stats/stats-page').then((m) => m.StatsPage),
      },
      {
        path: 'log',
        title: 'Log food',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () => import('./features/log/log-page').then((m) => m.LogPage),
      },
      {
        path: 'entries/:id',
        title: 'Edit entry',
        canDeactivate: [unsavedChangesGuard],
        loadComponent: () =>
          import('./features/entry-edit/entry-edit-page').then((m) => m.EntryEditPage),
      },
      {
        path: 'history',
        title: 'History',
        loadComponent: () => import('./features/history/history-page').then((m) => m.HistoryPage),
      },
      {
        path: 'foods',
        title: 'Food database',
        loadComponent: () => import('./features/foods/foods-page').then((m) => m.FoodsPage),
      },
      {
        path: 'favorites',
        title: 'Favorites',
        loadComponent: () =>
          import('./features/favorites/favorites-page').then((m) => m.FavoritesPage),
      },
      {
        path: 'compare',
        title: 'Compare',
        loadComponent: () => import('./features/compare/compare-page').then((m) => m.ComparePage),
      },
      {
        path: 'settings/my-foods',
        title: 'My foods',
        loadComponent: () =>
          import('./features/settings/my-foods/my-foods-page').then((m) => m.MyFoodsPage),
      },
      {
        path: 'settings',
        title: 'Settings',
        loadComponent: () =>
          import('./features/settings/settings-page').then((m) => m.SettingsPage),
      },
      {
        path: 'admin',
        title: 'Admin',
        canActivate: [adminGuard],
        loadComponent: () => import('./features/admin/admin-page').then((m) => m.AdminPage),
      },
      { path: '**', redirectTo: 'today' },
    ],
  },
];
