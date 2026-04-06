import { test, expect } from '@playwright/test';

test.describe('Auth flow', () => {
  test('login page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
    await expect(page.locator('.login-brand-title')).toHaveText('OpenAWork');
    await expect(page.getByText('登录以继续使用')).toBeVisible();
  });

  test('redirects unauthenticated user to login', async ({ page }) => {
    await page.goto('/chat');
    await expect(page).toHaveURL('/');
  });

  test('shows error on bad credentials', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('邮箱').fill('bad@example.com');
    await page.getByLabel('密码').fill('wrongpassword');
    await page.getByLabel('密码').press('Enter');
    await expect(
      page.getByText(/invalid credentials|login failed|network error|无效凭据|登录超时|网络错误/i),
    ).toBeVisible();
  });
});
