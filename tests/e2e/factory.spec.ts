import { expect, test } from '@playwright/test';

test('complete Arabic project journey, human gates, preview, persistence and ZIP', async ({
  page,
  request,
}) => {
  const name = `مشروع اختبار ${Date.now()}`;
  let projectId: string | undefined;
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'لنصنع شيئًا رائعًا.' })).toBeVisible();
    await page.getByRole('button', { name: 'مشروع جديد', exact: true }).click();
    await page.getByLabel('اسم المشروع', { exact: false }).fill(name);
    await page
      .getByLabel('صف فكرتك', { exact: false })
      .fill('لوحة مهام عربية لاختبار الإضافة والحذف وتوثيق المتطلبات والاعتماد.');
    const created = page.waitForResponse(
      (res) => res.url().endsWith('/api/v1/projects') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'إنشاء المشروع', exact: true }).click();
    projectId = (await (await created).json()).id;
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ابدأ التشغيل التجريبي' }).click();
    await expect(page.getByRole('button', { name: 'اعتماد ومتابعة' })).toBeVisible();
    const editor = page.getByRole('textbox', { name: 'وثيقة المتطلبات' });
    await expect(editor).toBeVisible();
    await editor.fill((await editor.inputValue()) + '\n\nمعيار إضافي للتوثيق: دعم لوحة المفاتيح.');
    await expect(page.getByRole('button', { name: 'اعتماد ومتابعة' })).toBeDisabled();
    await page.getByRole('button', { name: 'حفظ التعديلات' }).click();
    await expect(page.getByRole('button', { name: 'اعتماد ومتابعة' })).toBeEnabled();
    await page.getByRole('button', { name: 'اعتماد ومتابعة' }).click();
    await expect(page.getByRole('button', { name: 'اعتماد التسليم' })).toBeVisible();
    await page.getByRole('tab', { name: 'الملفات' }).click();
    await page.getByRole('button', { name: 'report.json', exact: true }).click();
    await expect(page.locator('.file-content pre')).toContainText('"code_executed": false');
    await page.getByRole('button', { name: 'معاينة القالب' }).click();
    const frame = page.frameLocator('iframe[title="معاينة لوحة المهام"]');
    await frame.getByRole('textbox', { name: 'اسم المهمة' }).fill('مهمة الاختبار');
    await frame.getByRole('button', { name: 'إضافة مهمة' }).click();
    await expect(frame.locator('#tasks')).toContainText('مهمة الاختبار');
    await frame.getByRole('checkbox', { name: 'إنجاز مهمة الاختبار' }).check();
    await expect(frame.locator('#summary')).toHaveText('1 من 1 مهام مكتملة');
    await frame.getByRole('button', { name: 'حذف مهمة الاختبار' }).click();
    await expect(frame.locator('#empty')).toBeVisible();
    // The preview cannot read its parent's DOM or use the network.
    const boundaries = await frame.locator('body').evaluate(async () => {
      let parentBlocked = false;
      try {
        void parent.document.body;
      } catch {
        parentBlocked = true;
      }
      // A failed fetch alone could just be DNS/CORS; require an actual CSP event.
      const violation = new Promise<boolean>((resolve) => {
        const onViolation = (event: SecurityPolicyViolationEvent) => {
          if (event.effectiveDirective === 'connect-src') {
            clearTimeout(timeout);
            document.removeEventListener('securitypolicyviolation', onViolation);
            resolve(true);
          }
        };
        const timeout = setTimeout(() => {
          document.removeEventListener('securitypolicyviolation', onViolation);
          resolve(false);
        }, 2000);
        document.addEventListener('securitypolicyviolation', onViolation);
      });
      await fetch('https://github.com/').catch(() => undefined);
      return { parentBlocked, cspBlocked: await violation };
    });
    expect(boundaries).toEqual({ parentBlocked: true, cspBlocked: true });
    await frame.getByRole('textbox', { name: 'اسم المهمة' }).fill('<img src=x onerror=alert(1)>');
    await frame.getByRole('button', { name: 'إضافة مهمة' }).click();
    await expect(frame.locator('#tasks')).toContainText('<img src=x onerror=alert(1)>');
    await expect(frame.locator('#tasks img')).toHaveCount(0);
    await page.getByRole('dialog').getByRole('button', { name: 'إغلاق', exact: true }).click();
    await page.getByRole('button', { name: 'اعتماد التسليم' }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('link', { name: 'تنزيل المشروع ZIP' }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toMatch(/^factory-.*\.zip$/);
    expect(await download.failure()).toBeNull();
    await page.reload();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('link', { name: 'تنزيل المشروع ZIP' })).toBeVisible();
    expect(consoleErrors).toEqual([]);
  } finally {
    if (projectId) await request.delete(`/api/v1/projects/${projectId}`);
  }
});

test('mobile navigation, template choice, dialog keyboard and no horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'لنصنع شيئًا رائعًا.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await page.getByRole('button', { name: 'مكتبة القوالب', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'أقل إعدادًا، أكثر إنجازًا.' })).toBeVisible();
  await page.locator('.template-card.available').click();
  await expect(page.getByLabel('اسم المشروع', { exact: false })).toHaveValue('مساحة المهام');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'فتح القائمة' }).click();
  await page.getByRole('button', { name: 'الإعدادات', exact: true }).click();
  await expect(
    page.getByText('غير مفعلة · ليست خدمة متعددة المستخدمين', { exact: true }),
  ).toBeVisible();
});

test('project search and explicit deletion only remove the selected project', async ({
  page,
  request,
}) => {
  const name = `مشروع للحذف ${Date.now()}`;
  const response = await request.post('/api/v1/projects', {
    data: { name, description: 'مشروع مؤقت للتحقق من البحث وتأكيد الحذف على واجهة المصنع.' },
  });
  const p = await response.json();
  try {
    await page.goto('/');
    await page.getByRole('textbox', { name: 'البحث في المشاريع' }).fill(name);
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
    await page.getByRole('button', { name: `حذف ${name}`, exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'حذف المشروع؟' })).toBeVisible();
    await page.getByRole('button', { name: 'احتفظ بالمشروع' }).click();
    expect((await request.get(`/api/v1/projects/${p.id}`)).status()).toBe(200);
    await page.getByRole('button', { name: `حذف ${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'حذف نهائي', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'لا توجد مشاريع مطابقة' })).toBeVisible();
    expect((await request.get(`/api/v1/projects/${p.id}`)).status()).toBe(404);
  } finally {
    await request.delete(`/api/v1/projects/${p.id}`);
  }
});

test('cancelled runs remain readable and a new attempt resumes independently on mobile', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const name = `محاولات مستقلة ${Date.now()}`;
  const created = await request.post('/api/v1/projects', {
    data: { name, description: 'اختبار سجل محاولات المشروع وإلغائها دون فقد البيانات المحفوظة.' },
  });
  const project = await created.json();
  try {
    await page.goto('/');
    await page.getByRole('button', { name, exact: true }).click();
    await page.getByRole('button', { name: 'ابدأ التشغيل التجريبي' }).click();
    await expect(page.getByRole('button', { name: 'اعتماد ومتابعة' })).toBeVisible();
    const initialRun = (await (await request.get(`/api/v1/projects/${project.id}`)).json()).runs[0];
    await page.getByRole('tab', { name: 'نظرة عامة', exact: true }).click();
    await page.getByRole('button', { name: 'إنهاء التشغيل' }).click();
    await expect(page.getByRole('button', { name: 'تشغيل جديد' })).toBeVisible();
    expect((await (await request.get(`/api/v1/runs/${initialRun.id}`)).json()).status).toBe(
      'cancelled',
    );
    await page.getByRole('button', { name: 'تشغيل جديد' }).click();
    await expect(page.getByRole('button', { name: 'اعتماد ومتابعة' })).toBeVisible();
    const runs = (await (await request.get(`/api/v1/projects/${project.id}`)).json()).runs;
    expect(runs).toHaveLength(2);
    await page.getByLabel('اختيار التشغيل').selectOption(initialRun.id);
    await expect(page.getByRole('button', { name: 'اعتماد ومتابعة' })).toHaveCount(0);
    // A historical terminal run must not advertise starting a third active run.
    await expect(page.getByRole('button', { name: 'تشغيل جديد' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'نظرة عامة', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'المتطلبات', exact: true })).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'وثيقة المتطلبات' })).toHaveAttribute(
      'readonly',
      '',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByLabel('اختيار التشغيل').selectOption(runs[0].id);
    await expect(page.getByRole('button', { name: 'اعتماد ومتابعة' })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('button', { name: 'اعتماد ومتابعة' })).toBeVisible();
  } finally {
    await request.delete(`/api/v1/projects/${project.id}`);
  }
});

test('failed API connection has an actionable error and can recover without a reload', async ({
  page,
}) => {
  await page.route('**/api/v1/projects', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('main').getByRole('alert')).toContainText('تعذر الاتصال بالخادم');
  await expect(page.locator('.system-status')).toContainText('الخادم غير متصل');
  await page.unroute('**/api/v1/projects');
  await page.getByRole('button', { name: 'إعادة المحاولة', exact: true }).click();
  await expect(page.locator('.system-status')).toContainText('خدمة المشاريع متصلة');
  await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
});
