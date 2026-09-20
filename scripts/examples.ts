import ExcelJS from 'exceljs';
import { writeFileSync } from 'node:fs';
writeFileSync(
  'public/examples/clientes.csv',
  'Código;Nome;E-mail;Cidade;Situação;Observações\n001;Ana Lima;ana@example.test;Campo Grande;Ativo;Prefere contato por e-mail\n002;Bruno Costa;bruno@example.test;Dourados;Ativo;\n003;Clara Alves;clara@example.test;Bonito;Em análise;Aguardando retorno\n004;Daniel Melo;daniel@example.test;Três Lagoas;Ativo;\n005;Elisa Ramos;elisa@example.test;Corumbá;Inativo;Cadastro de demonstração\n',
);
const book = new ExcelJS.Workbook();
const cats = book.addWorksheet('Categorias');
cats.addRows([
  ['Código', 'Categoria'],
  ['AL', 'Alimentos'],
  ['LI', 'Limpeza'],
  ['PA', 'Papelaria'],
]);
const products = book.addWorksheet('Produtos');
products.addRows([
  ['Inventário de demonstração — valores fictícios'],
  ['Código', 'Produto', 'Categoria', 'Quantidade', 'Preço', 'Ativo'],
  ['001', 'Café 500g', 'AL', 28, 19.9, true],
  ['002', 'Chá de camomila', 'AL', 14, 8.5, true],
  ['003', 'Detergente', 'LI', 32, 3.9, true],
  ['004', 'Caderno', 'PA', 0, 14.5, false],
]);
const totals = book.addWorksheet('Resumo');
totals.addRows([
  ['Indicador', 'Resultado'],
  ['Itens em estoque', { formula: 'SUM(Produtos!D3:D6)', result: 74 }],
]);
await book.xlsx.writeFile('public/examples/estoque.xlsx');
