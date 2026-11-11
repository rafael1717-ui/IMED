// Testes das regras de busca usadas no site. Rodar com: node --test tests/*.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../assets/js/geo-core.js';

const PAULISTA = { lat: -23.565, lng: -46.652 };

const imedRow = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Centro de Imagem Perto', kind: 'imagem', description: null,
  address_line: 'Av. Paulista, 1000', neighborhood: 'Bela Vista', city: 'São Paulo', state: 'SP', cep: '01310-100',
  lat: -23.5655, lng: -46.6525, distance_m: 70, phone: '1130000000', whatsapp: '5511987654321', email: null, website: 'imagem.com.br',
  specialties: ['Radiologia'], opening_hours: { seg: '07:00–19:00' }, accepts_online_booking: true, is_demo: false,
  exams: [{ code: 'rm', price_cents: 45000 }, { code: 'tc', price_cents: null }],
};

test('classifica estabelecimentos do OpenStreetMap', () => {
  assert.equal(G.classifyOsm({ name: 'Delboni Medicina Diagnóstica', healthcare: 'clinic' })?.kind, 'imagem');
  assert.equal(G.classifyOsm({ name: 'Laboratório Central', amenity: 'clinic' })?.kind, 'laboratorio');
  assert.equal(G.classifyOsm({ name: 'Hospital Sírio-Libanês', amenity: 'hospital' })?.kind, 'hospital');
  assert.equal(G.classifyOsm({ name: 'Clínica Odontológica Sorriso', amenity: 'clinic' }), null);
  assert.equal(G.classifyOsm({ name: 'Consultório', healthcare: 'clinic', 'healthcare:speciality': 'dentist' }), null);
  const cardio = G.classifyOsm({ name: 'Instituto do Coração', healthcare: 'clinic', 'healthcare:speciality': 'cardiology;general' });
  assert.equal(cardio?.kind, 'clinica');
  assert.deepEqual(cardio?.specialties, ['Cardiologia', 'Clínico geral']);
  assert.deepEqual(G.classifyOsm({ name: 'Centro de Ressonância e Tomografia', healthcare: 'radiology' })?.services, ['rm', 'tc']);
});

test('reconhece exames pelo nome', () => {
  assert.deepEqual(G.examsFromText('Clínica de Ultrassom e Mamografia', 'imagem'), ['usg', 'mamo']);
  assert.deepEqual(G.examsFromText('Raio-X 24h', 'imagem'), ['rx']);
  assert.deepEqual(G.examsFromText('Fleury', 'laboratorio'), ['lab']);
  assert.deepEqual(G.examsFromText('Clínica São Paulo', 'clinica'), []);
});

test('traduz horários do OpenStreetMap sem inventar nada', () => {
  assert.equal(G.formatOsmHours('Mo-Fr 07:00-19:00; Sa 07:00-12:00'), 'seg–sex 07:00–19:00 · sáb 07:00–12:00');
  assert.equal(G.formatOsmHours('24/7'), 'Aberto 24 horas');
  assert.equal(G.formatOsmHours('Su off'), 'dom fechado');
});

test('consulta do Overpass usa um retângulo em volta do raio', () => {
  const q = G.overpassQuery(PAULISTA, 2000);
  const [s, w, n, e] = q.match(/\[bbox:([^\]]+)\]/)[1].split(',').map(Number);
  assert.ok(s < PAULISTA.lat && n > PAULISTA.lat && w < PAULISTA.lng && e > PAULISTA.lng);
  assert.ok(Math.abs((n - s) * 111320 - 4000) < 5, 'altura de 4 km');
  assert.match(q, /healthcare/);
  assert.match(q, /out center tags 1000/);
});

test('lê o Overpass, remove repetidos e quem está fora do raio, e ordena por distância', () => {
  const places = G.parseOverpass({
    elements: [
      { type: 'way', id: 2, center: { lat: -23.57, lon: -46.66 }, tags: { name: 'Lab Longe', healthcare: 'laboratory', phone: '+55 11 3000-0000;+55 11 3000-0001', opening_hours: 'Mo-Fr 06:00-18:00' } },
      { type: 'node', id: 1, lat: -23.5655, lon: -46.6525, tags: { name: 'Centro de Imagem Perto', healthcare: 'radiology', 'addr:street': 'Av. Paulista', 'addr:housenumber': '1000', 'addr:suburb': 'Bela Vista', website: 'imagem.com.br', 'contact:whatsapp': '(11) 98765-4321' } },
      { type: 'node', id: 3, lat: -23.5655, lon: -46.6525, tags: { name: 'Centro de Imagem Perto', healthcare: 'radiology' } },
      { type: 'node', id: 4, lat: -23.566, lon: -46.653, tags: { healthcare: 'clinic' } },
      { type: 'node', id: 5, lat: -23.566, lon: -46.653, tags: { name: 'Pet Clínica Veterinária', amenity: 'clinic' } },
      { type: 'node', id: 6, lat: -23.70, lon: -46.90, tags: { name: 'Hospital Longe Demais', amenity: 'hospital' } },
    ],
  }, PAULISTA, 3000);
  assert.deepEqual(places.map((p) => p.name), ['Centro de Imagem Perto', 'Lab Longe']);
  assert.equal(places[0].address, 'Av. Paulista, 1000 · Bela Vista');
  assert.equal(places[0].website, 'https://imagem.com.br/');
  assert.equal(places[0].whatsapp, '5511987654321');
  assert.equal(places[0].maps_url, 'https://www.openstreetmap.org/node/1');
  assert.equal(places[1].phone, '+55 11 3000-0000');
  assert.deepEqual(places[1].hours, ['seg–sex 06:00–18:00']);
  assert.equal(places[1].hours_source, 'osm');
  assert.equal(places[1].prices, null, 'estabelecimentos do mapa não têm preço');
});

test('classifica o Google no site e descarta dentistas', () => {
  const lab = G.normalizeGoogle({ id: 'google:c', name: 'Laboratório Vida', types: ['medical_lab'], hint: null, lat: -23.567, lng: -46.654, phone: '(11) 3333-4444', hours: null }, PAULISTA);
  assert.equal(lab.kind, 'laboratorio');
  assert.deepEqual(lab.services, ['lab']);
  assert.equal(lab.hours, null);
  const img = G.normalizeGoogle({ id: 'google:a', name: 'Lumen', types: ['doctor'], hint: 'imagem', lat: -23.566, lng: -46.653, hours: ['segunda-feira: 07:00–19:00'] }, PAULISTA);
  assert.equal(img.kind, 'imagem');
  assert.equal(img.hours_source, 'google');
  assert.equal(G.normalizeGoogle({ id: 'google:b', name: 'Radiologia Odontológica', types: ['dentist'], lat: -23.5, lng: -46.6 }, PAULISTA), null);
});

test('clínica do banco sem inventar preço nem horário', () => {
  const c = G.normalizeImedRow(imedRow, PAULISTA);
  assert.equal(c.source, 'imed');
  assert.equal(c.address, 'Av. Paulista, 1000 · Bela Vista · São Paulo - SP');
  assert.deepEqual(c.prices, { rm: 45000, tc: null });
  assert.deepEqual(c.services, ['rm', 'tc']);
  assert.deepEqual(c.hours, ['Segunda: 07:00–19:00']);
  assert.equal(c.website, 'https://imagem.com.br/');
  const semHorario = G.normalizeImedRow({ ...imedRow, opening_hours: null }, PAULISTA);
  assert.equal(semHorario.hours, null);
  assert.equal(semHorario.hours_source, null);
});

test('estabelecimento do CNES com turno oficial, sem preço e com link da ficha', () => {
  const row = {
    cnes: '2077485', name: 'Hospital Exemplo', kind: 'hospital', cnes_type: 5, address_line: 'Rua A, 10',
    neighborhood: 'Centro', cep: '01310100', city: 'São Paulo', uf: 'SP', city_code: '355030',
    lat: -23.56, lng: -46.65, location_source: 'cnes', phone: '(11) 3333-4444', shift: null, open_24h: true,
    sus: true, services: ['rx'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-01',
  };
  const c = G.normalizeCnes(row, PAULISTA);
  assert.equal(c.id, 'cnes:2077485');
  assert.equal(c.source, 'cnes');
  assert.equal(c.address, 'Rua A, 10 · Centro · São Paulo - SP');
  assert.equal(c.cep, '01310-100');
  assert.deepEqual(c.hours, ['Aberto 24 horas']);
  assert.equal(c.hours_source, 'cnes');
  assert.equal(c.prices, null);
  assert.equal(c.maps_url, 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302077485');
  assert.equal(c.sus, true);
  assert.equal(c.approx, false);
  const outro = G.normalizeCnes({ ...row, kind: 'xyz', open_24h: false, shift: null, cep: '123', location_source: 'endereco', city_code: null }, PAULISTA);
  assert.equal(outro.kind, 'clinica');
  assert.equal(outro.hours, null);
  assert.equal(outro.cep, null);
  assert.equal(outro.approx, true);
  assert.equal(outro.maps_url, null);
  assert.deepEqual(G.normalizeCnes({ ...row, open_24h: false, shift: 'Manhã e tarde' }, PAULISTA).hours, ['Manhã e tarde']);
});

test('não repete no mapa uma clínica que já é parceira IMED', () => {
  const ours = [G.normalizeImedRow(imedRow, PAULISTA)];
  const map = G.parseOverpass({ elements: [
    { type: 'node', id: 1, lat: -23.5656, lon: -46.6526, tags: { name: 'Centro de Imagem Perto', healthcare: 'radiology' } },
    { type: 'node', id: 2, lat: -23.5700, lon: -46.6600, tags: { name: 'Outra Clínica', amenity: 'clinic' } },
  ] }, PAULISTA);
  assert.deepEqual(G.mergePlaces(ours, map).map((p) => p.id), ['imed:11111111-1111-4111-8111-111111111111', 'osm:n2']);
});

test('filtra por tipo, exame, especialidade, distância e preço informado', () => {
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const semPreco = G.normalizeImedRow({ ...imedRow, id: '22222222-2222-4222-8222-222222222222', name: 'Outra IMED', exams: [{ code: 'rm', price_cents: null }] }, PAULISTA);
  const [lab] = G.parseOverpass({ elements: [{ type: 'node', id: 9, lat: -23.58, lon: -46.65, tags: { name: 'Laboratório X', healthcare: 'laboratory' } }] }, PAULISTA);
  const all = [imed, semPreco, lab];
  const f = (o) => G.filterPlaces(all, { ...G.DEFAULT_FILTERS, ...o }).map((p) => p.name);
  assert.deepEqual(f({}), ['Centro de Imagem Perto', 'Outra IMED', 'Laboratório X']);
  assert.deepEqual(f({ kind: 'laboratorio' }), ['Laboratório X']);
  assert.deepEqual(f({ exam: 'rm' }), ['Centro de Imagem Perto', 'Outra IMED']);
  assert.deepEqual(f({ specialty: 'Radiologia' }), ['Centro de Imagem Perto', 'Outra IMED']);
  assert.deepEqual(f({ radius: 1000 }), ['Centro de Imagem Perto', 'Outra IMED']);
  assert.deepEqual(f({ onlyImed: true }), ['Centro de Imagem Perto', 'Outra IMED']);
  assert.deepEqual(f({ price: '300a600' }), ['Centro de Imagem Perto'], 'só quem informou preço');
  assert.deepEqual(f({ price: 'ate100' }), []);
  assert.deepEqual(f({ exam: 'tc', price: '300a600' }), [], 'tomografia sem preço informado');
  assert.equal(G.activeFilterCount({ ...G.DEFAULT_FILTERS, exam: 'rm', onlyImed: true }), 2);
});

test('ordena por distância, nome e preço (sem preço por último)', () => {
  const a = { name: 'B', distance_m: 300, prices: { rm: 50000 } };
  const b = { name: 'A', distance_m: 100, prices: null };
  const c = { name: 'C', distance_m: 200, prices: { rm: 30000 } };
  assert.deepEqual(G.sortPlaces([a, b, c], 'dist').map((p) => p.name), ['A', 'C', 'B']);
  assert.deepEqual(G.sortPlaces([a, b, c], 'name').map((p) => p.name), ['A', 'B', 'C']);
  assert.deepEqual(G.sortPlaces([a, b, c], 'price', 'rm').map((p) => p.name), ['C', 'B', 'A']);
});

test('formata distância e preço', () => {
  assert.equal(G.formatDistance(63), '60 m');
  assert.equal(G.formatDistance(4), '10 m');
  assert.equal(G.formatDistance(1234), '1,2 km');
  assert.equal(G.formatDistance(15300), '15 km');
  assert.equal(G.formatPrice(45000).replace(/\s/g, ' '), 'R$ 450');
  assert.equal(G.formatPrice(12990).replace(/\s/g, ' '), 'R$ 129,90');
});

test('valida o pedido de agendamento', () => {
  const ok = { exam: 'rm', date: '2026-11-03', period: 'manha', name: 'Ana Souza', phone: '(11) 98765-4321', email: '', notes: '', consent: true };
  assert.deepEqual(G.validateBooking(ok, '2026-10-28', '2027-01-26'), {});
  const bad = G.validateBooking({ ...ok, date: '2026-10-01', phone: '1234', email: 'x@', consent: false, name: ' ' }, '2026-10-28', '2027-01-26');
  assert.deepEqual(Object.keys(bad).sort(), ['consent', 'date', 'email', 'name', 'phone']);
  assert.ok(G.validateBooking({ ...ok, date: '2027-03-01' }, '2026-10-28', '2027-01-26').date);
  assert.equal(G.isValidPhone('11987654321'), true);
  assert.equal(G.isValidPhone('1133334444'), true);
  assert.equal(G.isValidPhone('0198765432'), false);
  assert.equal(G.maskPhone('11987654321'), '(11) 98765-4321');
  assert.equal(G.maskPhone('1133334444'), '(11) 3333-4444');
});

test('monta o pedido no formato do banco', () => {
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const v = { exam: 'rm', date: '2026-11-03', period: 'tarde', name: '  Ana   Souza ', phone: '(11) 98765-4321', email: ' Ana@Email.com ', notes: '', consent: true };
  const row = G.bookingRow(imed, v, 'abc');
  assert.equal(row.clinic_id, imedRow.id);
  assert.equal(row.place_source, 'imed');
  assert.equal(row.place_ref, null);
  assert.equal(row.patient_name, 'Ana Souza');
  assert.equal(row.patient_phone, '11987654321');
  assert.equal(row.patient_email, 'ana@email.com');
  assert.equal(row.notes, null);
  assert.equal(row.consent, true);
  assert.ok(!('status' in row), 'o status é sempre definido pelo banco');
  const [osm] = G.parseOverpass({ elements: [{ type: 'node', id: 7, lat: -23.566, lon: -46.653, tags: { name: 'Clínica do Mapa', amenity: 'clinic', phone: '+55 11 3000-0000' } }] }, PAULISTA);
  const row2 = G.bookingRow(osm, v, 'def');
  assert.equal(row2.clinic_id, null);
  assert.equal(row2.place_source, 'osm');
  assert.equal(row2.place_ref, 'osm:n7');
  assert.equal(row2.place_phone, '+55 11 3000-0000');
});

test('links de contato seguros', () => {
  assert.equal(G.telHref('(11) 3333-4444'), 'tel:+551133334444');
  assert.equal(G.telHref('+55 11 3333-4444'), 'tel:+551133334444');
  assert.equal(G.telHref('0800 123 4567'), 'tel:08001234567');
  assert.equal(G.safeUrl('javascript:alert(1)'), null);
  assert.equal(G.safeUrl('www.clinica.com.br'), 'https://www.clinica.com.br/');
  assert.equal(G.whatsappHref('5511987654321', 'Olá'), 'https://wa.me/5511987654321?text=Ol%C3%A1');
  assert.equal(G.protocolFromId('3f2a9c1e-0000-4000-8000-000000000000'), 'IMED-3F2A9C1E');
});

test('datas no fuso de São Paulo', () => {
  const noon = Date.UTC(2026, 9, 28, 15, 0);
  assert.equal(G.spDate(0, noon), '2026-10-28');
  assert.equal(G.spDate(90, noon), '2027-01-26');
  assert.equal(G.spDate(0, Date.UTC(2026, 9, 29, 2, 30)), '2026-10-28', '23h30 em São Paulo ainda é dia 28');
  assert.equal(G.roundCoord(-23.5651234), -23.565);
});

test('parceiro leva convênios e código CNES; filtros de SUS e convênio', () => {
  const imed = G.normalizeImedRow({ ...imedRow, insurances: [' Bradesco Saúde ', 'SulAmérica', 'bradesco saude', ''], cnes: '1234567' }, PAULISTA);
  assert.deepEqual(imed.insurances, ['Bradesco Saúde', 'SulAmérica']);
  assert.equal(imed.cnes, '1234567');
  assert.deepEqual(G.normalizeImedRow(imedRow, PAULISTA).insurances, [], 'sem convênio informado, lista vazia');
  const outra = G.normalizeImedRow({ ...imedRow, id: '33333333-3333-4333-8333-333333333333', name: 'Outra', insurances: ['Amil'] }, PAULISTA);
  const base = { cnes: '1', name: 'UBS', kind: 'clinica', lat: -23.566, lng: -46.653, location_source: 'cnes', services: [], specialties: [] };
  const sus = G.normalizeCnes({ ...base, sus: true }, PAULISTA);
  const semSus = G.normalizeCnes({ ...base, cnes: '2', name: 'Privada', sus: false }, PAULISTA);
  const all = [imed, outra, sus, semSus];
  const f = (o) => G.filterPlaces(all, { ...G.DEFAULT_FILTERS, ...o }).map((p) => p.name);
  assert.equal(G.DEFAULT_FILTERS.sus, false);
  assert.equal(G.DEFAULT_FILTERS.insurance, '');
  assert.deepEqual(f({ sus: true }), ['UBS'], 'parceiros não informam SUS e ficam de fora');
  assert.deepEqual(f({ insurance: 'bradesco saúde' }), ['Centro de Imagem Perto'], 'compara sem diferenciar maiúsculas');
  assert.deepEqual(f({ insurance: 'Amil' }), ['Outra']);
  assert.deepEqual(f({ insurance: 'Unimed' }), []);
  assert.deepEqual(G.insuranceOptions(all), ['Amil', 'Bradesco Saúde', 'SulAmérica']);
  assert.equal(G.activeFilterCount({ ...G.DEFAULT_FILTERS, sus: true, insurance: 'Amil' }), 2);
  assert.equal(G.activeFilterCount(G.DEFAULT_FILTERS), 0);
});

test('faixa de preço só com preços informados por parceiros', () => {
  const a = G.normalizeImedRow(imedRow, PAULISTA); // rm 450, tc sem preço
  const b = G.normalizeImedRow({ ...imedRow, id: '44444444-4444-4444-8444-444444444444', exams: [{ code: 'rm', price_cents: 89990 }] }, PAULISTA);
  const demo = G.normalizeImedRow({ ...imedRow, id: '55555555-5555-4555-8555-555555555555', is_demo: true, exams: [{ code: 'rm', price_cents: 100 }] }, PAULISTA);
  const cnes = G.normalizeCnes({ cnes: '9', name: 'X', kind: 'imagem', lat: -23.566, lng: -46.653, services: ['rm'], specialties: [] }, PAULISTA);
  assert.deepEqual(G.priceRange([a, b, demo, cnes], 'rm'), { min: 45000, max: 89990, count: 2 });
  assert.deepEqual(G.priceRange([a], 'rm'), { min: 45000, max: 45000, count: 1 });
  assert.equal(G.priceRange([a, b, cnes], 'tc'), null, 'sem preço informado não há faixa');
  assert.equal(G.priceRange([], 'rm'), null);
});

test('ordena por nota sem inventar avaliação', () => {
  const list = [{ id: 'a', name: 'A', distance_m: 100 }, { id: 'b', name: 'B', distance_m: 200 }, { id: 'c', name: 'C', distance_m: 300 }, { id: 'd', name: 'D', distance_m: 50 }];
  const ratings = new Map([['b', { rating: 4.2, reviews: 3 }], ['c', { rating: 4.8, reviews: 10 }], ['a', { rating: 4.2, reviews: 7 }]]);
  assert.deepEqual(G.sortPlaces(list, 'rating', '', ratings).map((p) => p.id), ['c', 'a', 'b', 'd']);
  assert.equal(G.formatRating(4.6), '4,6');
  assert.equal(G.formatRating('5'), '5,0');
});

test('rótulos da situação do pedido', () => {
  assert.equal(G.statusLabel('pending'), 'Aguardando contato');
  assert.equal(G.statusLabel('pendente'), 'Aguardando contato');
  assert.equal(G.statusLabel('contacted'), 'Em contato');
  assert.equal(G.statusLabel('confirmed'), 'Confirmado');
  assert.equal(G.statusLabel('cancelled'), 'Cancelado');
  assert.equal(G.statusLabel('completed'), 'Concluído');
  assert.equal(G.statusLabel('xyz'), '');
  assert.equal(G.statusLabel(undefined), '');
  // As 7 situações da agenda nova (fase 4.2): o paciente vê um texto simples para cada uma.
  const novas = {
    hold: 'Reserva temporária', awaiting_payment: 'Aguardando pagamento', checked_in: 'Chegada registrada',
    in_service: 'Em atendimento', no_show: 'Não compareceu', reschedule_requested: 'Remarcação solicitada', expired: 'Reserva expirada',
  };
  for (const [st, txt] of Object.entries(novas)) assert.equal(G.statusLabel(st), txt, st);
});

test('preparo resumido para todos os exames', () => {
  for (const code of ['rx', 'usg', 'tc', 'rm', 'mamo', 'dens', 'ecg', 'eco', 'lab', 'consulta', 'outro']) {
    assert.ok(typeof G.PREP[code] === 'string' && G.PREP[code].length > 10, code);
  }
});

test('pedido com campos extras (código de avaliação)', () => {
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const v = { exam: 'rm', date: '2026-11-03', period: 'tarde', name: 'Ana', phone: '11987654321', email: '', notes: '', consent: true };
  const hash = 'a'.repeat(64);
  assert.equal(G.bookingRow(imed, v, 'x', { review_token_hash: hash }).review_token_hash, hash);
  assert.ok(!('review_token_hash' in G.bookingRow(imed, v, 'x')));
});

test('arquivo de agenda (.ics) válido, com fuso, lembrete e escapes', () => {
  const now = Date.UTC(2026, 9, 30, 12, 0, 0);
  const ics = G.icsFile({ id: 'abc-123', title: 'Exame: Ressonância — Clínica A, B; C', date: '2026-11-03', period: 'manha', description: 'Linha 1\nRetire metais; leve exames, se tiver.', url: 'https://imed.example/' }, now);
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'todas as quebras são CRLF');
  const lines = ics.split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.equal(lines.at(-2), 'END:VCALENDAR');
  assert.ok(lines.includes('BEGIN:VEVENT') && lines.includes('END:VEVENT'));
  assert.ok(lines.includes('VERSION:2.0'));
  assert.ok(lines.includes('DTSTART;TZID=America/Sao_Paulo:20261103T080000'));
  assert.ok(lines.includes('DTEND;TZID=America/Sao_Paulo:20261103T120000'));
  assert.ok(lines.includes('BEGIN:VTIMEZONE') && lines.includes('TZID:America/Sao_Paulo'));
  assert.ok(lines.includes('DTSTAMP:20261030T120000Z'));
  assert.ok(lines.includes('UID:abc-123@imed'));
  assert.ok(lines.includes('BEGIN:VALARM') && lines.includes('TRIGGER:-P1D') && lines.includes('END:VALARM'));
  const unfolded = ics.replace(/\r\n /g, '');
  assert.ok(unfolded.includes('SUMMARY:Exame: Ressonância — Clínica A\\, B\\; C (a confirmar)\r\n'), 'vírgula e ponto e vírgula escapados no título; sem confirmação, "(a confirmar)"');
  assert.ok(lines.includes('STATUS:TENTATIVE'), 'pedido sem confirmação fica como provisório');
  assert.ok(unfolded.includes('DESCRIPTION:Amanhã: Exame: Ressonância — Clínica A\\, B\\; C (a confirmar)\r\n'), 'o lembrete de um dia antes também avisa');
  assert.ok(unfolded.includes('DESCRIPTION:Linha 1\\nRetire metais\\; leve exames\\, se tiver.\r\n'), 'escapes na descrição');
  assert.doesNotMatch(unfolded, /B; C/);
  assert.doesNotMatch(unfolded, /metais; leve/);
  assert.ok(lines.every((l) => new TextEncoder().encode(l).length <= 75), 'linhas dobradas em até 75 bytes');
  const tarde = G.icsFile({ id: 'x', title: 'T', date: '2026-11-03', period: 'tarde' }, now);
  assert.match(tarde, /DTSTART;TZID=America\/Sao_Paulo:20261103T130000\r\nDTEND;TZID=America\/Sao_Paulo:20261103T180000/);
  const noite = G.icsFile({ id: 'x', title: 'T', date: '2026-11-03', period: 'noite' }, now);
  assert.match(noite, /T180000\r\nDTEND;TZID=America\/Sao_Paulo:20261103T210000/);
  const dia = G.icsFile({ id: 'x', title: 'T', date: '2026-12-31', period: 'qualquer' }, now);
  assert.match(dia, /DTSTART;VALUE=DATE:20261231\r\nDTEND;VALUE=DATE:20270101/);
  assert.ok(!dia.includes('VTIMEZONE'));
  assert.match(dia, /TRIGGER:-P1D/);
  assert.throws(() => G.icsFile({ id: 'x', title: 'T', date: '03/11/2026', period: 'manha' }));
});

test('.ics: "(a confirmar)" só enquanto o local não confirma', () => {
  const now = Date.UTC(2026, 9, 30, 12, 0, 0);
  const sum = (ics) => ics.replace(/\r\n /g, '').split('\r\n').find((l) => l.startsWith('SUMMARY:'));
  assert.equal(sum(G.icsFile({ id: 'x', title: 'RM · Hospital', date: '2026-11-03', period: 'manha' }, now)), 'SUMMARY:RM · Hospital (a confirmar)');
  const conf = G.icsFile({ id: 'x', title: 'RM · Hospital', date: '2026-11-03', period: 'manha', confirmed: true }, now);
  assert.equal(sum(conf), 'SUMMARY:RM · Hospital', 'confirmado pelo local: sem o aviso');
  assert.match(conf, /STATUS:CONFIRMED/);
  assert.equal(sum(G.icsFile({ id: 'x', title: 'RM', slot: '2026-11-05T12:30:00Z' }, now)), 'SUMMARY:RM', 'horário marcado já nasce confirmado');
  assert.equal(G.icsTitle('A (a confirmar)', false), 'A (a confirmar)', 'não repete o aviso');
  assert.equal(G.icsTitle('A', true), 'A');
});

test('avisos de confiança do pedido: gratuito, privacidade, emergência e fonte oficial', () => {
  assert.match(G.TRUST.gratis, /O IMED é gratuito para você/);
  assert.match(G.TRUST.gratis, /pagamento é feito direto no local/);
  assert.match(G.TRUST.gratis, /nunca pede Pix, depósito, senha ou código por telefone ou WhatsApp/);
  assert.match(G.TRUST.privacidade, /só para o IMED e para o local escolhido/);
  assert.match(G.TRUST.privacidade, /servidor no Brasil/);
  assert.match(G.TRUST.privacidade, /sem anúncios e sem rastreadores de anúncio/);
  assert.match(G.TRUST.privacidade, /localização é aproximada e não é gravada/);
  assert.match(G.TRUST.cnes, /serviço privado, sem vínculo com o governo ou o SUS/);
  assert.match(G.sosHTML(), /href="tel:192"/);
  assert.match(G.sosHTML(), /^<p class="sos">/);
  assert.match(G.sosHTML(G.TRUST.sosPedido), /não é para emergência/);
  const t = G.trustHTML();
  assert.ok(t.startsWith('<div class="trust">') && t.includes('class="free"') && t.includes('class="priv"'));
});

test('horários no fuso de São Paulo: dia, hora, período e agrupamento', () => {
  assert.deepEqual(G.spDateTime('2026-11-05T12:30:00Z'), { date: '2026-11-05', time: '09:30' });
  assert.deepEqual(G.spDateTime('2026-11-06T01:00:00Z'), { date: '2026-11-05', time: '22:00' }, 'vira o dia pelo fuso de SP, não pelo UTC');
  assert.equal(G.spDateTime('xx'), null);
  assert.equal(G.spDateTime(null), null);
  assert.equal(G.periodOfTime('08:00'), 'manha');
  assert.equal(G.periodOfTime('12:00'), 'tarde');
  assert.equal(G.periodOfTime('18:30'), 'noite');
  const g = G.groupSlots([
    { slot_start: '2026-11-05T13:00:00Z' }, { slot_start: '2026-11-05T12:30:00+00:00' }, { slot_start: '2026-11-05T12:30:00Z' },
    { slot_start: '2026-11-06T11:00:00Z' }, { slot_start: 'quebrado' }, null,
  ]);
  assert.deepEqual([...g.keys()], ['2026-11-05', '2026-11-06']);
  assert.deepEqual(g.get('2026-11-05').map((s) => s.time), ['09:30', '10:00'], 'em ordem e sem repetir');
  assert.equal(g.get('2026-11-05')[0].iso, '2026-11-05T12:30:00.000Z');
  assert.deepEqual(G.dayTab('2026-11-05'), { wd: 'qui', day: '05/11' });
  assert.match(G.formatSlot('2026-11-05T12:30:00Z'), /^quinta-feira, 05 de novembro às 09:30$/);
  const now = Date.parse('2026-10-30T15:00:00Z');
  const days = G.nextDays(14, now);
  assert.equal(days.length, 14);
  assert.equal(days[0], '2026-10-30');
  assert.equal(days[13], '2026-11-12');
});

test('pedido com horário marcado: validação, linha do banco e resumo no aparelho', () => {
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const v = { exam: 'rm', slot: '2026-11-05T17:30:00Z', name: 'Ana', phone: '(11) 98765-4321', consent: true };
  assert.deepEqual(G.validateBooking(v, '2026-10-30', '2027-01-28'), {}, 'com horário, data e período não são pedidos');
  assert.ok(G.validateBooking({ ...v, slot: 'nada' }, '2026-10-30', '2027-01-28').slot);
  assert.ok(G.validateBooking({ ...v, slot: '2026-10-01T12:00:00Z' }, '2026-10-30', '2027-01-28').slot, 'horário no passado');
  assert.ok(G.validateBooking({ ...v, slot: '' }, '2026-10-30', '2027-01-28').date, 'sem horário volta a pedir data');
  const row = G.bookingRow(imed, v, 'id1');
  assert.equal(row.slot_start, '2026-11-05T17:30:00.000Z');
  assert.equal(row.preferred_date, '2026-11-05');
  assert.equal(row.preferred_period, 'tarde', '14:30 em São Paulo');
  assert.equal(row.clinic_id, imedRow.id);
  assert.equal(row.consent, true);
  assert.ok(!('status' in row), 'quem confirma é o banco');
  assert.ok(!('slot_start' in G.bookingRow(imed, { ...v, slot: undefined, date: '2026-11-05', period: 'manha' }, 'id2')));
  const a = G.localAppt(imed, v, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'tok', Date.parse('2026-10-30T12:00:00Z'));
  assert.equal(a.status, 'confirmado');
  assert.equal(a.slot, '2026-11-05T17:30:00.000Z');
  assert.equal(a.date, '2026-11-05');
  assert.equal(a.period, 'tarde');
  assert.equal(a.code, 'IMED-AAAAAAAA');
  assert.deepEqual(a.items, ['Ressonância']);
  const b = G.localAppt(imed, { exam: 'consulta', date: '2026-11-05', period: 'manha' }, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'tok');
  assert.equal(b.status, 'pendente');
  assert.ok(!('slot' in b));
  // Telefone do local (o mesmo do pedido): para lembrar a pessoa de avisar o local se cancelar um horário combinado.
  assert.equal(G.localAppt({ ...imed, phone: '(11) 3141-1000' }, v, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'tok').phone, '(11) 3141-1000');
  assert.ok(!('phone' in G.localAppt({ ...imed, phone: null }, v, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'tok')), 'sem telefone, sem o campo');
  assert.equal(G.statusLabel('confirmado'), 'Confirmado');
  assert.ok(G.isSlotTaken({ status: 409 }));
  assert.ok(G.isSlotTaken({ status: 400, data: { code: '23P01' } }));
  assert.ok(G.isSlotTaken({ code: '23505' }));
  assert.ok(!G.isSlotTaken({ status: 400, data: { code: '22023' } }));
});

test('.ics com hora exata do horário marcado: em UTC e com a duração real', () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const ics = G.icsFile({ id: 'abc', title: 'Exame: RM', slot: '2026-11-05T12:30:00Z', minutes: 45 }, now);
  assert.match(ics, /DTSTART:20261105T123000Z\r\n/, 'instante em UTC: o calendário mostra na hora certa em qualquer fuso');
  assert.match(ics, /DTEND:20261105T131500Z\r\n/, 'sem o fim, `minutes` minutos');
  assert.match(ics, /STATUS:CONFIRMED/);
  assert.ok(!/VTIMEZONE|TZID/.test(ics), 'horário marcado não precisa de fuso no arquivo');
  const real = G.icsFile({ id: 'abc', title: 'Exame: RM', slot: '2026-11-05T12:30:00Z', slotEnd: '2026-11-05T13:40:00Z' }, now);
  assert.match(real, /DTSTART:20261105T123000Z\r\nDTEND:20261105T134000Z\r\n/, 'o fim real do exame (slot_end)');
  const torto = G.icsFile({ id: 'abc', title: 'T', slot: '2026-11-05T12:30:00Z', slotEnd: '2026-11-05T12:00:00Z' }, now);
  assert.match(torto, /DTEND:20261105T130000Z/, 'fim antes do início é ignorado (30 min)');
  const late = G.icsFile({ id: 'x', title: 'T', slot: '2026-11-06T02:45:00Z' }, now);
  assert.match(late, /DTSTART:20261106T024500Z\r\nDTEND:20261106T031500Z/);
  assert.throws(() => G.icsFile({ id: 'x', title: 'T', slot: 'amanhã' }));
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const full = G.bookingIcs(imed, { exam: 'rm', slot: '2026-11-05T12:30:00Z', slotEnd: '2026-11-05T13:00:00Z', tz: 'America/Manaus', procName: 'Ressonância do joelho', prep: 'Jejum de 4 horas.' },
    'aaaaaaaa-0000-4000-8000-000000000000', 'https://imed.example/', now);
  const unf = full.replace(/\r\n /g, '');
  assert.match(full, /DTSTART:20261105T123000Z\r\nDTEND:20261105T130000Z/);
  assert.match(unf, /Agendamento IMED-AAAAAAAA/);
  assert.match(unf, /SUMMARY:Exame: Ressonância do joelho — /, 'o nome do procedimento da clínica');
  assert.match(unf, /Horário: quinta-feira\\, 05 de novembro às 08:30 \(horário de Manaus\)/, 'a hora no fuso da unidade, escrita');
  assert.match(unf, /Preparo: Jejum de 4 horas\./, 'o preparo informado pela clínica');
  const pedido = G.bookingIcs(imed, { exam: 'rm', date: '2026-11-05', period: 'manha' }, 'aaaaaaaa-0000-4000-8000-000000000000', 'https://imed.example/', now);
  assert.match(pedido, /STATUS:TENTATIVE/);
  assert.match(pedido, /DTSTART;TZID=America\/Sao_Paulo:20261105T080000/, 'pedido sem horário: a faixa do período, como antes');
});

test('horário direto (5.1): fuso da unidade, próximo horário livre e duração', () => {
  assert.deepEqual(G.zonedDateTime('2026-11-05T12:30:00Z', 'America/Manaus'), { date: '2026-11-05', time: '08:30' });
  assert.deepEqual(G.zonedDateTime('2026-11-05T12:30:00Z', 'Fuso/Inventado'), { date: '2026-11-05', time: '09:30' }, 'fuso desconhecido vira São Paulo');
  assert.equal(G.validTz('America/Cuiaba'), 'America/Cuiaba');
  assert.equal(G.validTz('<script>'), 'America/Sao_Paulo');
  assert.equal(G.validTz(null), 'America/Sao_Paulo');
  assert.equal(G.tzLabel('America/Sao_Paulo'), 'horário de Brasília');
  assert.equal(G.tzLabel('America/Manaus'), 'horário de Manaus');
  assert.equal(G.tzLabel('America/Noronha'), 'horário de Fernando de Noronha');
  assert.ok(!G.tzDiffers('2026-11-05T12:30:00Z', 'America/Sao_Paulo', 'America/Bahia'), 'mesma hora no aparelho: nada a escrever');
  assert.ok(G.tzDiffers('2026-11-05T12:30:00Z', 'America/Sao_Paulo', 'Asia/Tokyo'));
  assert.ok(G.tzDiffers('2026-11-05T12:30:00Z', 'America/Manaus', 'America/Sao_Paulo'));
  const g = G.groupSlots([{ slot_start: '2026-11-06T03:30:00Z', slot_end: '2026-11-06T04:00:00Z' }, { slot_start: '2026-11-06T04:30:00Z' }], 'America/Manaus');
  assert.deepEqual([...g.keys()], ['2026-11-05', '2026-11-06'], 'o dia é o da unidade (23:30 de Manaus ainda é dia 05)');
  assert.deepEqual(g.get('2026-11-05')[0], { iso: '2026-11-06T03:30:00.000Z', time: '23:30', end: '2026-11-06T04:00:00.000Z' });
  assert.equal(g.get('2026-11-06')[0].end, null);
  assert.match(G.formatSlot('2026-11-05T12:30:00Z', 'America/Manaus'), /^quinta-feira, 05 de novembro às 08:30$/);
  const now = Date.parse('2026-11-11T15:00:00Z'); // quarta, 12:00 em São Paulo
  assert.equal(G.zonedDate(0, now), '2026-11-11');
  assert.equal(G.zonedDate(1, Date.parse('2026-11-12T03:30:00Z'), 'America/Manaus'), '2026-11-12', '23:30 de Manaus: amanhã é dia 12');
  assert.deepEqual(G.nextDays(3, Date.parse('2026-11-12T03:30:00Z'), 'America/Manaus'), ['2026-11-11', '2026-11-12', '2026-11-13']);
  assert.equal(G.nextFreeText('2026-11-11T17:30:00Z', 'America/Sao_Paulo', now), 'hoje às 14:30');
  assert.equal(G.nextFreeText('2026-11-12T11:00:00Z', 'America/Sao_Paulo', now), 'amanhã às 08:00');
  assert.equal(G.nextFreeText('2026-11-14T12:00:00Z', 'America/Sao_Paulo', now), 'sáb 14/11 às 09:00');
  assert.equal(G.nextFreeText('quebrado', 'America/Sao_Paulo', now), '');
  assert.equal(G.durationText(30), '30 min');
  assert.equal(G.durationText(60), '1 h');
  assert.equal(G.durationText(75), '1 h 15 min');
  assert.equal(G.durationText(0), '');
});

test('horário direto (5.1): procedimentos à venda, só nas modalidades com confirmação na hora', () => {
  const info = {
    status: 'ok', online: true, mode: 'nativa', timezone: 'America/Sao_Paulo',
    procedures: [
      { id: 'AAAAAAAA-0000-4000-8000-000000000001', exam_code: 'rm', name: ' Ressonância ', duration_min: 30, price_cents: 45000, price_text: null, prep_text: 'Retire metais.', fasting_hours: 4 },
      { id: 'aaaaaaaa-0000-4000-8000-000000000002', exam_code: 'usg', name: 'Ultrassom', duration_min: 20, price_cents: null, price_text: 'sob consulta', prep_text: null, fasting_hours: null },
      { id: 'nao-e-uuid', exam_code: 'tc', name: 'Tomografia', duration_min: 20 },
      { id: 'aaaaaaaa-0000-4000-8000-000000000003', exam_code: 'tc', name: '', duration_min: 20 },
    ],
  };
  const procs = G.bookableProcedures(info);
  assert.deepEqual(procs.map((p) => p.id), ['aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000002'], 'só os bem formados');
  assert.deepEqual(procs[0], { id: 'aaaaaaaa-0000-4000-8000-000000000001', exam: 'rm', name: 'Ressonância', minutes: 30, price_cents: 45000, prep: 'Retire metais.', fasting: 4 });
  assert.equal(procs[1].price_cents, null, 'sem preço: sob consulta (nunca inventado)');
  assert.equal(G.procedureLabel(procs[0]), `Ressonância · ${G.formatPrice(45000)} · 30 min`);
  assert.match(G.procedureLabel(procs[1]), /^Ultrassom · preço sob consulta · 20 min$/);
  assert.equal(G.pickProcedure(procs, 'usg').id, procs[1].id);
  assert.equal(G.pickProcedure(procs, 'mamo').id, procs[0].id, 'exame que a clínica não vende: o primeiro');
  assert.equal(G.pickProcedure([], 'rm'), null);
  assert.deepEqual(G.bookableProcedures({ ...info, online: false }), [], 'venda desligada: pedido');
  assert.deepEqual(G.bookableProcedures({ ...info, mode: 'externa' }), [], 'agenda externa (sem integração): pedido');
  assert.deepEqual(G.bookableProcedures({ ...info, mode: 'pedido' }), []);
  assert.equal(G.bookableProcedures({ ...info, mode: 'manual' }).length, 2, 'manual (com o compromisso da clínica): horário direto');
  assert.deepEqual(G.bookableProcedures({ status: 'not_found' }), []);
  assert.deepEqual(G.bookableProcedures(null), []);
});

test('horário direto (5.1): intenção (id e código gravados antes do envio), argumentos e respostas de agenda_book', () => {
  const key = G.intentKey({ clinic: 'c1', procedure: 'p1', slot: '2026-11-05T12:30:00+00:00' });
  assert.equal(key, 'c1|p1|2026-11-05T12:30:00.000Z');
  const now = Date.parse('2026-11-11T15:00:00Z');
  const a = G.newIntent(key, now);
  assert.ok(G.isUuid(a.id));
  assert.match(a.token, /^[0-9a-f]{64}$/);
  assert.equal(a.created, '2026-11-11T15:00:00.000Z');
  assert.notEqual(G.newIntent(key, now).id, a.id, 'cada intenção nova tem outro id');
  assert.equal(G.intentFor(a, key, now + 60000), a, 'mesmo horário: a mesma intenção (o reenvio é seguro)');
  assert.equal(G.intentFor(a, G.intentKey({ clinic: 'c1', procedure: 'p1', slot: '2026-11-05T13:00:00Z' }), now), null, 'outro horário: outra intenção');
  assert.equal(G.intentFor(a, key, now + 2 * 86400000), null, 'velha demais');
  assert.equal(G.intentFor({ ...a, token: 'curto' }, key, now), null);
  assert.equal(G.intentFor(null, key, now), null);
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const args = G.agendaBookArgs(imed, { procedureId: 'aaaaaaaa-0000-4000-8000-000000000001', slot: '2026-11-05T12:30:00+00:00', name: '  Ana   Maria ',
    phone: '(11) 98765-4321', email: ' Ana@Exemplo.COM ', notes: 'não vai', consent: true }, a);
  assert.deepEqual(args, {
    p_clinic: imedRow.id, p_items: [{ procedure_id: 'aaaaaaaa-0000-4000-8000-000000000001', starts_at: '2026-11-05T12:30:00.000Z' }],
    p_patient: { name: 'Ana Maria', phone: '11987654321', email: 'ana@exemplo.com', consent: true }, p_id: a.id, p_token: a.token,
  });
  const outra = G.agendaBookArgs(imed, { procedureId: 'p', slot: '2026-11-05T12:30:00Z', name: 'Ana', phone: '11987654321', email: '', forOther: true,
    otherName: ' Bia ', relationship: 'Filho ou filha', otherMinor: true, guardianConsent: true }, a);
  assert.deepEqual(outra.p_patient, { name: 'Ana', phone: '11987654321', consent: true, for_other: true, other_name: 'Bia', relationship: 'Filho ou filha',
    other_minor: true, guardian_consent: true, other_consent: false }, 'só as chaves que o banco aceita (sem e-mail vazio, sem observações)');
  assert.deepEqual(G.bookOutcome({ status: 'ok', id: a.id, slot_start: '2026-11-05T12:30:00+00:00', slot_end: '2026-11-05T13:00:00+00:00' }),
    { kind: 'ok', slot: '2026-11-05T12:30:00+00:00', end: '2026-11-05T13:00:00+00:00', replay: false });
  assert.equal(G.bookOutcome({ status: 'ok', replay: true }).replay, true);
  assert.deepEqual(G.bookOutcome({ status: 'slot_taken', seq: 1, alternatives: ['2026-11-05T13:00:00+00:00', 'x'] }), { kind: 'taken', alternatives: ['2026-11-05T13:00:00+00:00'] });
  assert.equal(G.bookOutcome({ status: 'too_many_bookings' }).kind, 'limit');
  for (const st of ['not_online', 'agenda_not_started', 'not_found']) assert.equal(G.bookOutcome({ status: st }).kind, 'closed', st);
  for (const st of ['invalid_patient', 'consent_required', 'invalid']) assert.equal(G.bookOutcome({ status: st }).kind, 'invalid', st);
  assert.equal(G.bookOutcome({ status: 'idempotency_conflict' }).kind, 'retry');
  assert.equal(G.bookOutcome(null).kind, 'error');
  assert.equal(G.bookOutcome('ok').kind, 'error');
  for (const k of ['taken', 'limit', 'closed', 'invalid', 'retry', 'error']) assert.ok(G.BOOK_MSG[k], k);
});

test('isSlotTaken separa o horário ocupado (23P01, outra chave) do mesmo id reenviado (chave primária)', () => {
  assert.ok(G.isSlotTaken({ status: 409 }));
  assert.ok(G.isSlotTaken({ status: 400, data: { code: '23P01' } }));
  assert.ok(G.isSlotTaken({ code: '23505' }));
  assert.ok(G.isSlotTaken({ status: 'slot_taken' }), 'resposta slot_taken de agenda_book');
  assert.ok(G.isSlotTaken({ status: 409, data: { code: '23505', message: 'duplicate key value violates unique constraint "items_patient_no_overlap"' } }));
  const dup = { status: 409, data: { code: '23505', message: 'duplicate key value violates unique constraint "appointment_requests_pkey"', details: 'Key (id)=(…) already exists.' } };
  assert.ok(G.isDuplicateId(dup));
  assert.ok(!G.isSlotTaken(dup), 'o mesmo id que já chegou não é horário ocupado');
  assert.ok(!G.isDuplicateId({ status: 409, data: { code: '23P01' } }));
  assert.ok(!G.isSlotTaken({ status: 400, data: { code: '22023' } }));
});

test('página de cada local: referências, consultas e conversão das linhas do banco', () => {
  assert.deepEqual(G.parseLocalRef('cnes:2077485'), { source: 'cnes', key: '2077485' });
  assert.deepEqual(G.parseLocalRef('imed:AAAAAAAA-0000-4000-8000-000000000001'), { source: 'imed', key: 'aaaaaaaa-0000-4000-8000-000000000001' });
  assert.equal(G.parseLocalRef('cnes:123'), null);
  assert.equal(G.parseLocalRef('imed:1 or 1=1'), null);
  assert.equal(G.parseLocalRef('osm:n1'), null);
  const paths = G.localPaths({ source: 'cnes', key: '2077485' });
  assert.match(paths.main, /^establishments\?select=.*location.*municipalities\(name,uf,cnes_code\)&cnes=eq\.2077485$/);
  assert.equal(paths.partner, 'clinics?select=id&cnes=eq.2077485&status=eq.published');
  assert.match(G.localPaths({ source: 'imed', key: imedRow.id }).main, /clinic_exams\(exam_code,price_cents,price_updated_at\)&id=eq\..*&status=eq\.published$/);

  assert.deepEqual(G.pointFromGeo({ type: 'Point', coordinates: [-46.66, -23.56] }), { lat: -23.56, lng: -46.66 });
  assert.deepEqual(G.pointFromGeo('{"type":"Point","coordinates":[-46.66,-23.56]}'), { lat: -23.56, lng: -46.66 });
  assert.deepEqual(G.pointFromGeo('0101000020E61000003D0AD7A3705D47C0B81E85EB51C837C0'), { lat: -23.7825, lng: -46.73 }, 'EWKB em hexadecimal');
  assert.equal(G.pointFromGeo(null), null);
  assert.equal(G.pointFromGeo('qualquer coisa'), null);
  assert.equal(G.pointFromGeo({ type: 'Point', coordinates: [0, 0] }), null);

  const est = G.establishmentToPlace({
    cnes: '2077485', name: 'Hospital Santa Exemplo', legal_name: 'Assoc. Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625',
    neighborhood: 'Cerqueira César', cep: '01409001', phone: '(11) 3141-1000', shift: 'Manhã e tarde', open_24h: false, sus: true,
    services: ['rm'], specialties: ['Cardiologia'], cnes_updated_at: '2026-09-15', location_source: 'cnes',
    location: { type: 'Point', coordinates: [-46.6602, -23.5598] }, city_ibge: 3550308, municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 },
  });
  assert.equal(est.id, 'cnes:2077485');
  assert.equal(est.address, 'Rua Peixoto Gomide, 625 · Cerqueira César · São Paulo - SP');
  assert.equal(est.cep, '01409-001');
  assert.deepEqual([est.lat, est.lng], [-23.5598, -46.6602]);
  assert.equal(est.distance_m, null);
  assert.deepEqual(est.hours, ['Manhã e tarde']);
  assert.equal(est.sus, true);
  assert.equal(G.localUrl(est), 'local.html?cnes=2077485');
  assert.equal(G.localTitle(est), 'Hospital Santa Exemplo em São Paulo - SP | IMED');
  assert.match(G.localDescription(est), /^Hospital em São Paulo - SP\. Endereço, telefone, exames \(Ressonância\) e como agendar pelo IMED\. Atende SUS\.$/);
  const noGeo = G.establishmentToPlace({ cnes: '1234567', name: 'Sem Local', kind: 'clinica', location: null, municipalities: null });
  assert.equal(noGeo.lat, null);
  assert.equal(G.localTitle(noGeo), 'Sem Local | IMED');

  const cl = G.clinicToPlace({
    ...imedRow, lat: undefined, lng: undefined, exams: undefined, location: { type: 'Point', coordinates: [-46.6525, -23.5655] },
    clinic_exams: [{ exam_code: 'tc', price_cents: null }, { exam_code: 'rm', price_cents: 45000, price_updated_at: '2026-10-01' }, { exam_code: 'xyz' }],
  });
  assert.equal(cl.id, `imed:${imedRow.id}`);
  assert.deepEqual(cl.services, ['rm', 'tc']);
  assert.equal(G.priceFor(cl, 'rm'), 45000);
  assert.equal(G.priceFor(cl, 'tc'), null);
  assert.deepEqual(cl.priceDates, { rm: '2026-10-01' });
  assert.equal(G.localUrl(cl), `local.html?id=${imedRow.id}`);
  assert.equal(G.localUrl({ source: 'osm', id: 'osm:n1' }), null);

  const ld = G.localJsonLd(est, 'https://x/local.html?cnes=2077485');
  assert.equal(ld['@type'], 'Hospital');
  assert.equal(ld.address.postalCode, '01409-001');
  assert.equal(ld.address.streetAddress, 'Rua Peixoto Gomide, 625');
  assert.deepEqual(ld.geo, { '@type': 'GeoCoordinates', latitude: -23.5598, longitude: -46.6602 });
  assert.ok(!('aggregateRating' in ld), 'sem avaliação, sem nota');
  assert.ok(!('aggregateRating' in G.localJsonLd(est, 'u', { rating: 4, reviews: 0 })));
  assert.deepEqual(G.localJsonLd(est, 'u', { rating: 4.6, reviews: 12 }).aggregateRating, { '@type': 'AggregateRating', ratingValue: 4.6, reviewCount: 12, bestRating: 5, worstRating: 1 });
  assert.equal(G.localJsonLd(cl, 'u')['@type'], 'DiagnosticLab');
  assert.equal(G.localJsonLd(cl, 'u').address.streetAddress, 'Av. Paulista, 1000, Bela Vista');
  assert.ok(!('geo' in G.localJsonLd(noGeo, 'u')));
});

test('área inteira: distâncias até 50 km e contagem no formato do Brasil', () => {
  assert.deepEqual(G.RADII, [1000, 2000, 5000, 10000, 20000, 50000]);
  assert.equal(G.DEFAULT_FILTERS.radius, 5000, '5 km continua sendo o padrão');
  assert.equal(G.formatCount(3158), '3.158');
  assert.equal(G.formatCount(3000), '3.000');
  assert.equal(G.formatCount(999), '999');
  assert.equal(G.formatCount(0), '0');
});

test('área inteira: filtros do banco, chave e parâmetros das funções', () => {
  const o = { lat: -23.561, lng: -46.657 };
  const f = (x) => ({ ...G.DEFAULT_FILTERS, ...x });
  assert.deepEqual(G.areaArgs(o, f({})), { p_lat: -23.561, p_lng: -46.657, p_radius_m: 5000 }, 'sem filtro, sem p_kind/p_exam/p_sus');
  assert.deepEqual(G.areaArgs(o, f({ kind: 'hospital', exam: 'rm', sus: true, radius: 50000 })),
    { p_lat: -23.561, p_lng: -46.657, p_radius_m: 50000, p_kind: 'hospital', p_exam: 'rm', p_sus: true });
  assert.ok(!('p_sus' in G.areaArgs(o, f({ sus: false }))), 'SUS desligado não vira p_sus=false');
  assert.deepEqual(G.areaArgs(o, f({ kind: 'toString', exam: '__proto__' })), { p_lat: -23.561, p_lng: -46.657, p_radius_m: 5000 }, 'valores desconhecidos são ignorados');
  assert.equal(G.hasAreaFilter(f({})), false);
  assert.equal(G.hasAreaFilter(f({ specialty: 'Cardiologia', price: 'ate100', insurance: 'Amil', onlyImed: true })), false, 'esses filtros ficam no navegador');
  assert.equal(G.hasAreaFilter(f({ sus: true })), true);
  assert.equal(G.areaKey(f({})), '5000|||0');
  assert.equal(G.areaKey(f({ kind: 'imagem', sus: true, radius: 2000 })), '2000|imagem||1');
  assert.notEqual(G.areaKey(f({ exam: 'rm' })), G.areaKey(f({ exam: 'tc' })));
  assert.equal(G.areaKey(f({ specialty: 'Cardiologia', sort: 'name' })), G.areaKey(f({})), 'especialidade e ordem não mudam a consulta');
  assert.equal(G.onlyPartnerFilter(f({})), false);
  assert.equal(G.onlyPartnerFilter(f({ price: 'ate100' })), true);
  assert.equal(G.onlyPartnerFilter(f({ insurance: 'Amil' })), true);
  assert.equal(G.onlyPartnerFilter(f({ onlyImed: true })), true);
});

test('área inteira: total vindo do banco e pontos do mapa', () => {
  assert.equal(G.rowsTotal([{ cnes: '1', total: 3158 }, { cnes: '2', total: 3158 }]), 3158);
  assert.equal(G.rowsTotal([{ cnes: '1', total: '42' }]), 42);
  assert.equal(G.rowsTotal([]), null, 'sem linhas, total desconhecido');
  assert.equal(G.rowsTotal([{ cnes: '1' }]), null, 'sem a coluna, total desconhecido');
  assert.equal(G.rowsTotal(null), null);
  const { points, total } = G.normalizePoints([
    { cnes: '2077485', kind: 'hospital', lat: -23.5598, lng: -46.6602, total: 4 },
    { cnes: '2077485', kind: 'hospital', lat: -23.5598, lng: -46.6602, total: 4 },
    { cnes: '6543210', kind: 'desconhecido', lat: '-23.5655', lng: '-46.652', total: 4 },
    { cnes: '12', kind: 'clinica', lat: -23.5, lng: -46.6, total: 4 },
    { cnes: '7654321', kind: 'clinica', lat: null, lng: -46.6, total: 4 },
  ]);
  assert.equal(total, 4, 'o total é o do banco, mesmo com linhas descartadas');
  assert.deepEqual(points, [
    { cnes: '2077485', kind: 'hospital', lat: -23.5598, lng: -46.6602 },
    { cnes: '6543210', kind: 'clinica', lat: -23.5655, lng: -46.652 },
  ], 'sem repetir, sem código inválido e sem posição vazia');
  assert.deepEqual(G.normalizePoints('erro'), { points: [], total: null });
  assert.equal(G.POINT_FIELDS, 'cnes,kind,lat,lng,total');
});

test('área inteira: detalhe de um ponto do mapa sem pedir a localização', () => {
  const path = G.pointDetailPath('2077485');
  assert.match(path, /^establishments\?select=.+&cnes=eq\.2077485$/);
  const cols = new URLSearchParams(path.split('?')[1]).get('select').split(',');
  assert.ok(!cols.includes('location'), 'a posição já veio no ponto');
  assert.ok(cols.includes('municipalities(name') && cols.includes('sus'));
  assert.equal(G.pointDetailPath('20774&cnes=eq.1'), null, 'só código CNES válido');
  const p = G.pointToPlace({
    cnes: '2077485', name: 'Hospital Santa Exemplo', kind: 'hospital', address_line: 'Rua Peixoto Gomide, 625', neighborhood: 'Cerqueira César',
    cep: '01409001', phone: '(11) 3141-1000', shift: null, open_24h: true, sus: true, services: ['rm'], specialties: [], cnes_updated_at: '2026-09-15',
    location_source: 'cnes', municipalities: { name: 'São Paulo', uf: 'SP', cnes_code: 355030 },
  }, { cnes: '2077485', kind: 'hospital', lat: -23.5598, lng: -46.6602 }, PAULISTA);
  assert.equal(p.id, 'cnes:2077485');
  assert.equal(p.source, 'cnes');
  assert.equal(p.address, 'Rua Peixoto Gomide, 625 · Cerqueira César · São Paulo - SP');
  assert.equal(p.cep, '01409-001');
  assert.deepEqual([p.lat, p.lng], [-23.5598, -46.6602]);
  assert.equal(p.distance_m, Math.round(G.haversine(PAULISTA, { lat: -23.5598, lng: -46.6602 })));
  assert.equal(p.maps_url, 'https://cnes.datasus.gov.br/pages/estabelecimentos/ficha/identificacao/3550302077485');
  assert.deepEqual(p.hours, ['Aberto 24 horas']);
  assert.equal(p.sus, true);
  assert.equal(p.prices, null, 'sem preço inventado');
  const bare = G.pointToPlace({ name: 'Sem Município', kind: 'clinica', municipalities: null }, { cnes: '1234567', lat: -23.5, lng: -46.6 }, PAULISTA);
  assert.equal(bare.id, 'cnes:1234567');
  assert.equal(bare.maps_url, null);
});

test('área inteira: distância do banco (elipsoide), para quem está na borda do raio não sumir da lista', () => {
  const o = { lat: -23.561, lng: -46.657 };
  // ~4.997 m ao norte pelo banco; a conta na esfera daria ~5.017 m (fora dos 5 km).
  const edge = { cnes: '7000001', name: 'Laboratório da Borda', kind: 'laboratorio', lat: o.lat + 0.04512, lng: o.lng, services: [], specialties: [] };
  assert.ok(G.haversine(o, edge) > 5000, 'na esfera passaria de 5 km');
  const c = G.normalizeCnes({ ...edge, distance_m: 4997 }, o);
  assert.equal(c.distance_m, 4997, 'usa a distância que veio do banco');
  assert.equal(G.filterPlaces([c], { ...G.DEFAULT_FILTERS }).length, 1, 'continua dentro dos 5 km, como o banco contou');
  assert.equal(G.normalizeCnes({ ...edge, distance_m: '4997' }, o).distance_m, 4997, 'número em texto também vale');
  for (const d of [undefined, null, '', ' ', 'abc', -1, NaN, true]) {
    assert.equal(G.normalizeCnes({ ...edge, distance_m: d }, o).distance_m, Math.round(G.haversine(o, edge)), `sem distância válida (${String(d)}), calcula`);
  }
  const imed = G.normalizeImedRow({ ...imedRow, distance_m: 4999 }, o);
  assert.equal(imed.distance_m, 4999, 'parceiro também usa a distância do banco');
  assert.equal(G.normalizeImedRow({ ...imedRow, distance_m: undefined }, PAULISTA).distance_m, Math.round(G.haversine(PAULISTA, imedRow)));
  assert.equal(G.rowDistance({ lat: o.lat, lng: o.lng, distance_m: 0 }, o), 0, 'zero é distância válida');
});

test('área inteira: páginas de 50 e texto do botão "Ver mais"', () => {
  // Os 250 que vieram com a busca: as primeiras páginas não precisam ir ao banco.
  assert.deepEqual(G.pagerState({ view: 50, loaded: 250, served: 250, exhausted: false }, 3158), { visible: 50, next: 50, more: true, fetch: false });
  // Acabaram os já baixados: a próxima página vem do banco.
  assert.deepEqual(G.pagerState({ view: 250, loaded: 250, served: 250, exhausted: false }, 3158), { visible: 250, next: 50, more: true, fetch: true });
  // Últimos da área.
  assert.deepEqual(G.pagerState({ view: 3150, loaded: 3150, served: 3150, exhausted: false }, 3158), { visible: 3150, next: 8, more: true, fetch: true });
  assert.equal(G.pagerState({ view: 3200, loaded: 3158, served: 3158, exhausted: false }, 3158).more, false, 'tudo na tela');
  assert.equal(G.pagerState({ view: 50, loaded: 40, served: 40, exhausted: true }, null).more, false, 'o banco não tem mais');
  assert.deepEqual(G.pagerState({ view: 250, loaded: 250, served: 250, exhausted: false }, null), { visible: 250, next: 50, more: true, fetch: true }, 'sem total, tenta mais uma página');
  assert.deepEqual(G.pagerState({ view: 50, loaded: 60, served: 60, exhausted: true }, 60), { visible: 50, next: 10, more: true, fetch: false });
  assert.equal(G.moreLabel(50, 3158), 'Ver mais 50 (de 3.158)');
  assert.equal(G.moreLabel(8, null), 'Ver mais 8');
});

/* ======================= "Antes de ir: o que perguntar ao ligar" (L1) ======================= */
const cnesPlace = (o = {}) => G.normalizeCnes({
  cnes: '6543210', name: 'Laboratório Análise Paulista', kind: 'laboratorio', address_line: 'Alameda Santos, 200', city: 'São Paulo', uf: 'SP',
  lat: -23.5655, lng: -46.652, phone: '(11) 3000-2000', sus: false, services: ['lab'], specialties: [], ...o,
}, PAULISTA);
const ids = (list) => list.map((q) => q.id);
const textOf = (list, id) => list.find((q) => q.id === id)?.text ?? '';

test('perguntas ao ligar: "Vocês fazem…?" sempre primeiro; laboratório pergunta jejum, prazo e coleta em casa', () => {
  const lab = G.callQuestions(cnesPlace());
  assert.equal(lab[0].id, 'faz', 'o cadastro oficial deduz o serviço pelo nome: primeiro pergunta se faz');
  assert.equal(lab[0].text, 'Vocês fazem todos os exames do meu pedido médico?');
  assert.deepEqual(ids(lab), ['faz', 'agenda', 'preparo', 'convenio', 'preco', 'documentos', 'resultado', 'coleta', 'acesso']);
  assert.equal(textOf(lab, 'agenda'), 'Precisa agendar ou é por ordem de chegada?');
  assert.match(textOf(lab, 'preparo'), /jejum/);
  assert.equal(textOf(lab, 'resultado'), 'Em quantos dias sai o resultado?');
  assert.equal(textOf(lab, 'coleta'), 'Fazem coleta em casa?');
  assert.match(textOf(lab, 'convenio'), /^Aceitam o meu convênio\?/);
  assert.match(textOf(lab, 'preco'), /no particular\?$/);
  assert.match(textOf(lab, 'documentos'), /documentos.*pedido médico/);
  // Exame de laboratório num hospital: mesmas perguntas, sem a coleta em casa (é do laboratório).
  const hosp = G.callQuestions(cnesPlace({ kind: 'hospital', name: 'Hospital Santa Exemplo' }), 'lab');
  assert.equal(hosp[0].text, 'Vocês fazem todos os exames do meu pedido médico?');
  assert.ok(ids(hosp).includes('resultado') && !ids(hosp).includes('coleta'));
});

test('perguntas ao ligar: o exame escolhido entra no texto; imagem pergunta o pedido médico', () => {
  const img = cnesPlace({ kind: 'imagem', name: 'Centro de Imagem', services: ['rm', 'tc'] });
  const rm = G.callQuestions(img, 'rm');
  assert.equal(rm[0].text, 'Vocês fazem ressonância magnética?');
  assert.equal(textOf(rm, 'preparo'), 'Precisa de jejum ou de outro preparo para a ressonância magnética?');
  assert.equal(textOf(rm, 'preco'), 'Quanto custa a ressonância magnética no particular?');
  assert.match(textOf(rm, 'documentos'), /Precisa do pedido médico\?/);
  assert.ok(ids(rm).includes('resultado') && !ids(rm).includes('coleta'));
  assert.equal(G.callQuestions(img, 'rx')[0].text, 'Vocês fazem raio-X?');
  assert.equal(textOf(G.callQuestions(img, 'rx'), 'preco'), 'Quanto custa o raio-X no particular?');
  // Imagem sem exame escolhido: pergunta pelo exame do pedido, e o pedido médico continua.
  const any = G.callQuestions(img);
  assert.equal(any[0].text, 'Vocês fazem o exame do meu pedido médico?');
  assert.match(textOf(any, 'documentos'), /pedido médico/);
  // Todo exame da busca tem nome na pergunta (nada de "undefined" nem do código).
  for (const code of Object.keys(G.EXAMS)) {
    const list = G.callQuestions(img, code);
    assert.ok(list.every((q) => !/undefined|null/.test(q.text)), code);
    if (code !== 'lab') assert.match(list[0].text, new RegExp(`^Vocês fazem ${G.EXAMS[code].n.split(' ')[0].slice(0, 5)}`, 'i'), code);
  }
  // Clínica ou hospital sem exame: consulta ou exame, sem as perguntas próprias de exame.
  const geral = G.callQuestions(cnesPlace({ kind: 'clinica', name: 'Clínica Bela Vista', services: [] }));
  assert.equal(geral[0].text, 'Vocês fazem o exame ou a consulta de que eu preciso?');
  assert.equal(textOf(geral, 'documentos'), 'Que documentos preciso levar?');
  assert.ok(!ids(geral).includes('resultado') && !ids(geral).includes('coleta'));
  // Código desconhecido conta como nenhum exame.
  assert.deepEqual(G.callQuestions(img, '<b>x</b>'), any);
  assert.deepEqual(G.callQuestions(img, 'consulta'), any);
});

test('perguntas ao ligar: "Atendem pelo SUS?" só com sus=true do cadastro oficial; parceiro não tem roteiro', () => {
  assert.equal(textOf(G.callQuestions(cnesPlace({ sus: true })), 'sus'), 'Atendem pelo SUS? Precisa de encaminhamento do posto de saúde?');
  assert.ok(!ids(G.callQuestions(cnesPlace({ sus: false }))).includes('sus'), 'não atende SUS');
  assert.ok(!ids(G.callQuestions(cnesPlace({ sus: null }))).includes('sus'), 'sem a informação');
  const sus = G.callQuestions(cnesPlace({ sus: true }));
  assert.ok(ids(sus).indexOf('sus') > ids(sus).indexOf('convenio') && ids(sus).indexOf('sus') < ids(sus).indexOf('preco'));
  // Local do mapa público (sem o dado do SUS): perguntas sem o SUS.
  const osm = G.parseOverpass({ elements: [{ type: 'node', id: 102, lat: -23.559, lon: -46.66, tags: { name: 'Laboratório Vida', healthcare: 'laboratory', phone: '+55 11 3333-4444' } }] }, PAULISTA)[0];
  assert.equal(osm.source, 'osm');
  assert.deepEqual(ids(G.callQuestions(osm)), ['faz', 'agenda', 'preparo', 'convenio', 'preco', 'documentos', 'resultado', 'coleta', 'acesso']);
  // Parceiro: preço e agenda vêm da própria clínica.
  const partner = G.normalizeImedRow(imedRow, PAULISTA);
  assert.deepEqual(G.callQuestions(partner, 'rm'), []);
  assert.equal(G.callQuestionsText(partner, 'rm'), '');
  assert.equal(G.callQuestionsHTML(partner, 'rm'), '');
  assert.deepEqual(G.callQuestions(null), []);
});

test('perguntas ao ligar: só perguntas, sem preço, nota, horário nem número inventado', () => {
  const places = [cnesPlace({ sus: true }), cnesPlace({ kind: 'imagem' }), cnesPlace({ kind: 'hospital', sus: true }), cnesPlace({ kind: 'clinica', phone: null })];
  for (const p of places) {
    for (const exam of ['', ...Object.keys(G.EXAMS)]) {
      const list = G.callQuestions(p, exam);
      assert.ok(list.length >= 7 && list.length <= 10, `${p.kind}/${exam}: ${list.length} perguntas`);
      assert.equal(new Set(ids(list)).size, list.length, 'sem pergunta repetida');
      for (const { text } of list) {
        assert.match(text, /\?$/, `"${text}" termina em pergunta`);
        assert.ok(!/R\$|\d|nota|estrela|hor[aá]rio/i.test(text), `"${text}": sem preço, número, nota ou horário`);
      }
      const html = G.callQuestionsHTML(p, exam);
      assert.ok(!/R\$|\b\d{1,2}[:h]\d{2}\b|\bnota\b/i.test(html.replace(/rows="\d+"/, '')), 'a caixa também não traz preço, nota nem horário');
    }
  }
});

test('perguntas ao ligar: texto para copiar e a caixa fechada até o toque', () => {
  const p = cnesPlace({ name: 'Laboratório <img src=x onerror=alert(1)> & Cia', sus: true });
  const text = G.callQuestionsText(p, 'lab');
  const lines = text.split('\n');
  assert.equal(lines[0], 'Laboratório <img src=x onerror=alert(1)> & Cia · (11) 3000-2000', 'nome e telefone do local');
  assert.equal(lines[1], 'O que perguntar ao ligar:');
  assert.equal(lines[2], '1. Vocês fazem todos os exames do meu pedido médico?');
  assert.equal(lines.length, 2 + G.callQuestions(p, 'lab').length);
  assert.ok(lines.slice(2).every((l, i) => l.startsWith(`${i + 1}. `)), 'numeradas');
  assert.equal(G.callQuestionsText({ ...p, phone: null, name: 'Sem Telefone' }, '').split('\n')[0], 'Sem Telefone', 'sem telefone, só o nome');

  const html = G.callQuestionsHTML(p, 'lab');
  assert.match(html, /^<details class="cq">/, 'caixa <details>');
  assert.ok(!/<details[^>]*\bopen\b/.test(html), 'fechada até o toque');
  assert.match(html, /<summary>.*<span>Antes de ir: o que perguntar ao ligar<\/span>.*<\/summary>/s);
  assert.equal((html.match(/<li data-q=/g) ?? []).length, G.callQuestions(p, 'lab').length);
  assert.match(html, /<button class="btn btn-ghost btn-sm" type="button" data-act="copy-questions">.*Copiar as perguntas<\/button>/);
  assert.ok(!/tel:|data-act="share"|Compartilhar/.test(html), 'sem repetir Ligar e Compartilhar (já estão nas ações do local)');
  assert.match(html, /<p class="cq-msg" id="cq-msg-cnes-6543210" role="status"><\/p>/, 'aviso lido pelo leitor de tela');
  assert.match(html, /<textarea class="cq-txt" readonly hidden rows="\d+" aria-label="Perguntas para copiar" aria-describedby="cq-msg-cnes-6543210">/,
    'texto para selecionar quando não dá para copiar, ligado ao aviso que explica como copiar');
  // Ordem: botão, aviso, quadro. No celular, um aviso embaixo do quadro aberto ficava fora da tela.
  const at = (s) => html.indexOf(s);
  assert.ok(at('data-act="copy-questions"') < at('class="cq-msg"') && at('class="cq-msg"') < at('class="cq-txt"'), 'botão, aviso e só depois o quadro');
  assert.match(G.CALL_MSG.manual, /no quadro abaixo/);
  assert.ok(!html.includes('<img src=x'), 'nome do local escapado');
  assert.ok(html.includes('Laboratório &lt;img src=x onerror=alert(1)&gt; &amp; Cia'));
  assert.match(html, /Este local ainda não é parceiro do IMED: não sabemos o preparo que ele pede, o prazo do resultado nem o preço\. Ligue antes de ir, com o pedido médico em mãos, e pergunte:/);
  assert.ok(!/não temos o preparo/i.test(html), 'não sabemos o preparo DESTE local (os guias do IMED têm o preparo em geral)');
  assert.match(html, /siga também a orientação do seu médico/, 'saúde: siga o seu médico');
  assert.ok(!/telefone deste local não foi informado|na recepção|class="cq-imed"/.test(html), 'com telefone: ligar');
  // Clínica (consulta ou exame), sem telefone: não dá para ligar, então o que perguntar na recepção, e o pedido ao IMED
  // em destaque. Nada de "ao ligar" nem de "pedido médico em mãos".
  const clinic = cnesPlace({ kind: 'clinica', phone: null, name: 'Clínica Sem Telefone' });
  const noPhone = G.callQuestionsHTML(clinic);
  assert.match(noPhone, /<summary>.*<span>O que perguntar na recepção<\/span>.*<\/summary>/s);
  assert.equal(G.CALL_TITLE_RECEPCAO, 'O que perguntar na recepção');
  assert.ok(!/ao ligar|Ligue/.test(noPhone), 'sem telefone, nada de ligar');
  assert.match(noPhone, /não sabemos como ele agenda, o preparo que pede nem o preço\. O telefone deste local não foi informado\. Se for até lá, pergunte na recepção:/);
  assert.match(noPhone, /<p class="cq-imed"><i class="fa-solid fa-headset" aria-hidden="true"><\/i><span>Se preferir, peça ao IMED para agendar por você\.<\/span><\/p>/, 'pedido ao IMED em destaque');
  assert.ok(!/pedido médico/.test(noPhone), 'consulta: sem pedir o pedido médico');
  assert.deepEqual(G.callQuestionsText(clinic).split('\n').slice(0, 2), ['Clínica Sem Telefone', 'O que perguntar na recepção:']);
  // Laboratório sem telefone: leva o pedido médico até a recepção.
  assert.match(G.callQuestionsHTML(cnesPlace({ phone: null })), /Se for até lá, leve o pedido médico e pergunte na recepção:/);
});

test('perguntas ao ligar: onde o SUS aparece, o pedido ao IMED avisa que é particular ou convênio', () => {
  // Pelo IMED, o pedido é só particular ou convênio (TRUST.sus): quem filtrou "Atende SUS" não pode achar que o IMED
  // marca pelo SUS.
  assert.equal(G.CALL_IMED_SUS, 'Se preferir, peça ao IMED para agendar por você (particular ou convênio). Pelo SUS, o agendamento começa no posto de saúde (UBS).');
  assert.match(G.TRUST.sus, /particular ou por convênio.*Unidade Básica de Saúde \(UBS\)/, 'o mesmo que diz o aviso do pedido');
  const sus = G.callQuestionsHTML(cnesPlace({ sus: true }), 'lab');
  assert.ok(G.callQuestions(cnesPlace({ sus: true }), 'lab').some((q) => q.id === 'sus'));
  assert.match(sus, /siga também a orientação do seu médico\. Se preferir, peça ao IMED para agendar por você \(particular ou convênio\)\. Pelo SUS, o agendamento começa no posto de saúde \(UBS\)\.<\/p>/);
  // Sem telefone, o aviso vai junto do pedido ao IMED em destaque.
  const susNoPhone = G.callQuestionsHTML(cnesPlace({ sus: true, phone: null, kind: 'hospital' }));
  assert.match(susNoPhone, /<p class="cq-imed">.*<span>Se preferir, peça ao IMED para agendar por você \(particular ou convênio\)\. Pelo SUS, o agendamento começa no posto de saúde \(UBS\)\.<\/span><\/p>/s);
  // Sem a pergunta do SUS (não atende, sem a informação ou mapa público), o pedido ao IMED fica como sempre.
  for (const o of [{ sus: false }, { sus: null }, { sus: undefined }]) {
    const html = G.callQuestionsHTML(cnesPlace(o), 'rm');
    assert.ok(html.includes(` ${G.CALL_IMED}</p>`), JSON.stringify(o));
    assert.ok(!/SUS/.test(html), `${JSON.stringify(o)}: nada de SUS na caixa`);
  }
});

test('selo da agenda por modalidade (5.1): só o que é verdade, nunca "tempo real" nem "confirmada pela clínica"', () => {
  assert.equal(G.modeSeal('nativa').label, 'Horário confirmado na hora');
  assert.match(G.modeSeal('nativa').text, /agenda do IMED/);
  assert.equal(G.modeSeal('manual').label, 'Agenda atualizada pela clínica');
  assert.equal(G.modeSeal('externa'), null, 'agenda externa ainda não marca pelo site (fase 6)');
  assert.equal(G.modeSeal('pedido'), null);
  assert.equal(G.modeSeal('nativa', false), null, 'sem a venda online ligada, nenhum selo de agenda');
  assert.equal(G.modeSeal(undefined), null);
  for (const s of [...Object.values(G.MODE_SEAL), G.ONLINE_SEAL]) {
    assert.ok(!/tempo real|confirmad[ao]s? pela cl[ií]nica/i.test(`${s.label} ${s.text}`), s.label);
  }
});

test('horário direto (revisão 5.1): preparo até 600, procedimento da busca, exame sem horário, horários passados', () => {
  const longo = `${'Traga os exames anteriores e o pedido médico. '.repeat(13)}IMPORTANTE: suspenda a metformina 48 horas antes.`.slice(-600);
  assert.equal(longo.length, 600);
  const info = { status: 'ok', online: true, mode: 'nativa', procedures: [
    { id: 'aaaaaaaa-0000-4000-8000-000000000001', exam_code: 'rm', name: 'RM de abdome', duration_min: 30, prep_text: longo },
    { id: 'aaaaaaaa-0000-4000-8000-000000000002', exam_code: 'rm', name: 'RM de crânio', duration_min: 30 },
    { id: 'aaaaaaaa-0000-4000-8000-000000000003', exam_code: 'tc', name: 'Tomografia', duration_min: 20 },
  ] };
  const procs = G.bookableProcedures(info);
  assert.equal(procs[0].prep, longo, 'o preparo inteiro que o painel e o banco aceitam (600), sem cortar o aviso do fim');
  assert.match(procs[0].prep, /metformina 48 horas antes\.$/);
  assert.equal(G.pickProcedure(procs, 'rm', 'AAAAAAAA-0000-4000-8000-000000000002').name, 'RM de crânio', 'o procedimento do próximo horário da busca');
  assert.equal(G.pickProcedure(procs, 'rm', 'bbbbbbbb-0000-4000-8000-000000000009').name, 'RM de abdome', 'procedimento que não está à venda: pelo exame');
  assert.equal(G.examNotSold(procs, 'usg', ['rm', 'tc', 'usg']), 'usg', 'a clínica faz ultrassom, mas não vende com horário');
  assert.equal(G.examNotSold(procs, 'rm', ['rm', 'usg']), '', 'exame à venda');
  assert.equal(G.examNotSold(procs, 'mamo', ['rm']), '', 'exame que a clínica nem faz: nada a avisar');
  assert.equal(G.examNotSold(procs, '', ['rm']), '');
  const now = Date.parse('2026-11-17T12:40:00Z');
  const by = G.groupSlots([{ slot_start: '2026-11-17T12:00:00Z' }, { slot_start: '2026-11-17T12:30:00Z' }, { slot_start: '2026-11-17T17:00:00Z' }, { slot_start: '2026-11-18T12:00:00Z' }], 'America/Sao_Paulo');
  const left = G.dropPast(by, now);
  assert.deepEqual([...left.values()].flat().map((x) => x.iso), ['2026-11-17T17:00:00.000Z', '2026-11-18T12:00:00.000Z'], 'o que já começou sai da lista');
  assert.equal(G.dropPast(by, Date.parse('2026-11-17T18:00:00Z')).has('2026-11-17'), false, 'dia sem horário pela frente sai');
  // preparo da clínica guardado em Meus pedidos (para o .ics de lá)
  const imed = G.normalizeImedRow(imedRow, PAULISTA);
  const a = G.localAppt(imed, { exam: 'rm', slot: '2026-11-17T12:00:00Z', tz: 'America/Sao_Paulo', procName: 'RM de abdome', prep: `Jejum de 4 horas. ${longo}` }, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'tok');
  assert.match(a.prep, /^Jejum de 4 horas\. .*metformina 48 horas antes\.$/);
  assert.ok(!('prep' in G.localAppt(imed, { exam: 'rm', date: '2026-11-17', period: 'manha', prep: 'x' }, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'tok')), 'pedido sem horário: sem preparo da clínica');
  assert.equal(G.BOOK_MSG.limit.includes('Se preferir'), false);
});

test('horário direto (revisão 5.1): intenção de outro horário da mesma clínica é conferida (agenda_my_booking)', () => {
  const now = Date.parse('2026-11-11T15:00:00Z');
  const key = G.intentKey({ clinic: 'c1', procedure: 'p1', slot: '2026-11-17T12:00:00Z' });
  const a = G.newIntent(key, now);
  assert.equal(G.intentOfClinic(a, 'c1', now + 3600000), a, 'mesma clínica, qualquer horário');
  assert.equal(G.intentOfClinic(a, 'c2', now), null, 'outra clínica');
  assert.equal(G.intentOfClinic(a, 'c1', now + 2 * 86400000), null, 'mais de 1 dia: esquece');
  assert.equal(G.intentOfClinic({ ...a, key: 5 }, 'c1', now), null);
  assert.equal(G.intentOfClinic(null, 'c1', now), null);
  assert.equal(G.intentCheck({ status: 'ok', request_status: 'confirmed', slot_start: '2026-11-17T12:00:00+00:00' }), 'booked');
  assert.equal(G.intentCheck({ status: 'ok', request_status: 'cancelled', slot_start: '2026-11-17T12:00:00+00:00' }), 'none', 'cancelado: esquece');
  assert.equal(G.intentCheck({ status: 'ok', request_status: 'expired', slot_start: '2026-11-17T12:00:00+00:00' }), 'none');
  assert.equal(G.intentCheck({ status: 'not_found' }), 'none', 'o banco não gravou: esquece');
  assert.equal(G.intentCheck(null), 'unknown', 'falha de rede: guarda a intenção');
  assert.equal(G.intentCheck({ status: 'forbidden' }), 'unknown');
});

test('revisão 5.1: todo selo de agenda (MODE_SEAL e ONLINE_SEAL) está explicado em "Como funciona" e na legenda da busca', async () => {
  const { readFile } = await import('node:fs/promises');
  const como = await readFile(new URL('../como-funciona.html', import.meta.url), 'utf8');
  const perto = await readFile(new URL('../perto.html', import.meta.url), 'utf8');
  for (const s of [...Object.values(G.MODE_SEAL), G.ONLINE_SEAL]) {
    assert.ok(como.includes(s.label), `como-funciona.html explica "${s.label}"`);
    assert.ok(perto.includes(s.label), `legenda do perto.html explica "${s.label}"`);
  }
  assert.ok(!/<b>Agenda online<\/b>/.test(como), 'sem o selo antigo');
});
