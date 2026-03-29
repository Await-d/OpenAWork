import { test, expect } from '@playwright/test';

test.describe('Desktop app smoke tests', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('OpenAWork')).toBeVisible();
    await expect(page.getByPlaceholder('Email')).toBeVisible();
    await expect(page.getByPlaceholder('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('login redirects to sessions on valid credentials', async ({ page }) => {
    await page.route('**/auth/login', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ accessToken: 'test-at', refreshToken: 'test-rt' }),
      });
    });

    await page.route('**/sessions', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ sessions: [] }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/');
    await page.getByPlaceholder('Email').fill('test@example.com');
    await page.getByPlaceholder('Password').fill('testpassword');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page).toHaveURL(/\/sessions/);
  });

  test('login shows error on invalid credentials', async ({ page }) => {
    await page.route('**/auth/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid credentials' }),
      });
    });

    await page.goto('/');
    await page.getByPlaceholder('Email').fill('bad@example.com');
    await page.getByPlaceholder('Password').fill('wrongpass');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
  });

  test('settings page renders gateway URL input', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'openwork_auth',
        JSON.stringify({
          accessToken: 'test-at',
          refreshToken: 'test-rt',
          gatewayUrl: 'http://localhost:3000',
        }),
      );
    });

    await page.route('**/sessions', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessions: [] }),
      });
    });

    await page.goto('/settings');
    await expect(page.getByLabel('Gateway URL')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign Out' })).toBeVisible();
  });
});
