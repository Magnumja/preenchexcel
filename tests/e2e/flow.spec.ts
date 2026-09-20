import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { randomUUID } from 'node:crypto';
test('conta → CSV → revisão → edição → recarga → exportação e layouts', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/login');
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByLabel('Seu nome').fill('Teste de navegador');
  await page.getByLabel('E-mail').fill(`${randomUUID()}@example.test`);
  await page.getByLabel('Senha').fill(randomUUID());
  await page.getByRole('button', { name: 'Criar conta', exact: true }).click();
  await page.getByRole('button', { name: 'Criar meu espaço' }).click();
  await page.getByLabel('Nome do espaço').fill('Navegador');
  await page.getByRole('dialog').getByRole('button', { name: 'Criar espaço', exact: true }).click();
  await page.getByRole('link', { name: 'Novo projeto', exact: true }).first().click();
  await page.getByLabel('Escolher planilhas').setInputFiles('public/examples/clientes.csv');
  await page.getByLabel('Nome do projeto').fill('Clientes');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByLabel('Linha do cabeçalho')).toHaveValue('1');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Chave externa única').selectOption('c1');
  await page.getByRole('button', { name: 'Validar e ver prévia' }).click();
  await expect(page.getByText('5 registros no arquivo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Publicar aplicação' }).click();
  await page.getByRole('link', { name: 'Ana Lima', exact: true }).click();
  await page.getByLabel('Cidade', { exact: true }).fill('Nova cidade');
  await page.getByRole('link', { name: 'Projetos', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Há alterações não salvas' })).toBeVisible();
  await page.getByRole('button', { name: 'Continuar editando' }).click();
  await page.route('**/api/records/*', (route) =>
    route.request().method() === 'PATCH' ? route.abort() : route.continue(),
  );
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Cidade', { exact: true })).toHaveValue('Nova cidade');
  await page.unroute('**/api/records/*');
  await page.getByRole('button', { name: 'Salvar alterações' }).click();
  await expect(page.getByText('Alterações salvas', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Cidade', { exact: true })).toHaveValue('Nova cidade');
  await page.getByRole('button', { name: 'Histórico', exact: true }).click();
  await expect(page.getByText('Alteração · versão 2')).toBeVisible();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  for (const width of [320, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `test-results/ficha-${width}.png`, fullPage: true });
    const a = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(a.violations).toEqual([]);
  }
  await page.getByLabel('Caminho').getByRole('link', { name: 'clientes', exact: true }).click();
  // Novo registro: criar, cair na ficha criada e encontrá-lo na lista.
  await page.getByRole('link', { name: 'Novo registro' }).click();
  await page.getByLabel('Código', { exact: true }).fill('006');
  await page.getByLabel('Nome', { exact: true }).fill('Fábio Nunes');
  await page.getByRole('button', { name: 'Criar registro' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Fábio Nunes');
  await page.getByLabel('Caminho').getByRole('link', { name: 'clientes', exact: true }).click();
  await expect(page.getByText('6 registros', { exact: true })).toBeVisible();
  // Exclusão lógica e restauração pela ficha.
  await page.getByRole('link', { name: 'Fábio Nunes', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Excluir', exact: true }).click();
  await expect(page.getByText(/Registro excluído em/)).toBeVisible();
  await page.getByLabel('Caminho').getByRole('link', { name: 'clientes', exact: true }).click();
  await expect(page.getByText('5 registros', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Ver excluídos (1)' }).click();
  await page.getByRole('link', { name: 'Fábio Nunes', exact: true }).click();
  await page.getByRole('button', { name: 'Restaurar registro' }).click();
  await expect(page.getByText(/Registro excluído em/)).toHaveCount(0);
  await page.getByLabel('Caminho').getByRole('link', { name: 'clientes', exact: true }).click();
  await expect(page.getByText('6 registros', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Colunas' }).click();
  await page.getByLabel('E-mail', { exact: true }).uncheck();
  await expect(page.getByRole('columnheader', { name: 'E-mail' })).toHaveCount(0);
  // Reimportação sobre o conjunto: Ana foi editada no Preenche (conflito), 006 só existe aqui.
  await page.getByRole('link', { name: 'Adicionar planilha' }).click();
  await page.getByLabel('Escolher planilhas').setInputFiles('public/examples/clientes.csv');
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByLabel('Destino no projeto').selectOption({ label: 'Atualizar “clientes”' });
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await expect(page.getByLabel('Campo de destino').first()).toHaveValue('c1');
  await expect(page.getByText(/Aba pronta/)).toBeVisible();
  await page.getByRole('button', { name: 'Validar e ver prévia' }).click();
  await expect(page.getByText('ausentes no arquivo (mantidos)')).toBeVisible();
  await expect(page.getByText(/Conflitos: 001/)).toBeVisible();
  await page.getByRole('button', { name: 'Continuar', exact: true }).click();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Publicar aplicação' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Clientes');
  await expect(page.getByText('6 registros', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Ana Lima', exact: true }).click();
  await expect(page.getByLabel('Cidade', { exact: true })).toHaveValue('Nova cidade');
  await page.getByLabel('Caminho').getByRole('link', { name: 'clientes', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Exportar CSV' }).click();
  expect((await download).suggestedFilename()).toContain('.csv');
  expect(errors).toEqual([]);
});
