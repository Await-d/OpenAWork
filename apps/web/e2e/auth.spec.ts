import { test, expect } from '@playwright/test';

test.describe('Auth flow', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('OpenAWork')).toBeVisible();
    await expect(page.getByText('Sign in to continue')).toBeVisible();
  });

  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/chat');
    await expect(page).toHaveURL('/');
  });

  test('shows error on bad credentials', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Email').fill('bad@example.com');
    await page.getByLabel('Password').fill('wrongpassword');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText(/invalid credentials|login failed|network error/i)).toBeVisible();
  });
});
