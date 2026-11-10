// Endereço público do site para os testes, lido de assets/js/config.js (IMED_CONFIG.siteUrl), a fonte única.
// Nenhum teste escreve o endereço à mão: para trocá-lo, node scripts/trocar-endereco.mjs <endereço novo>.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CONFIG = readFileSync(fileURLToPath(new URL('../assets/js/config.js', import.meta.url)), 'utf8');
// Endereço inteiro, com a barra no fim: "https://<conta>.github.io/<repositório>/" ou "https://dominio/".
export const SITE = CONFIG.match(/siteUrl\s*:\s*['"]([^'"]+)['"]/)[1];
// Só o servidor: "https://<conta>.github.io".
export const ORIGEM = new URL(SITE).origin;
// Caminho do site no servidor, com as duas barras: "/<repositório>/" no GitHub Pages; "/" no domínio próprio.
// A página 404 usa esse caminho nos links e nos arquivos (ela abre em qualquer endereço do site).
export const CAMINHO = new URL(SITE).pathname;
// O mesmo, para juntar depois de um endereço que já termina em "/": "<repositório>/" ou "".
export const PASTA = CAMINHO.slice(1);
// Servidor de teste como o GitHub Pages: tira o caminho do site do começo do pedido ("/<repositório>/x" → "/x").
export const semCaminho = (path) => (CAMINHO !== '/' && path.startsWith(CAMINHO) ? path.slice(CAMINHO.length - 1) : path);
