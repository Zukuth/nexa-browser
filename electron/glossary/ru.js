// Russian -> {es} term overrides. Split out of translate.js's TERM_OVERRIDES
// into its own file (2026-09-04) — see electron/glossary/pt.js for why, and
// electron/glossary/index.js for how this plugs back in.
//
// Confirmed live this is where the bundled model is weakest: nearly every
// short isolated word came back either wrong ("фармить"/"to farm" -> "La
// farmacia", i.e. "the pharmacy") or wrapped in extra filler words a button
// label shouldn't have ("получить" -> "Consíguelo." instead of "Reclamar").
// Far more entries needed here than pt/en for that reason, not because more
// Russian words were checked.
module.exports = {
  'активно': { es: 'activo' },
  'неактивно': { es: 'inactivo' },
  'заблокировано': { es: 'bloqueado' },
  'разблокировано': { es: 'desbloqueado' },
  'обновить': { es: 'actualizar' },
  'выйти': { es: 'salir' },
  'войти': { es: 'iniciar sesión' },
  'купить': { es: 'comprar' },
  'продать': { es: 'vender' },
  'обменять': { es: 'intercambiar' },
  'получить': { es: 'reclamar' },
  'собрать': { es: 'recolectar' },
  'экипировать': { es: 'equipar' },
  'снять': { es: 'desequipar' },
  'прокачать': { es: 'subir de nivel' },
  'фармить': { es: 'farmear' },
  'гринд': { es: 'grindear' },
  'критический': { es: 'crítico' },
  'гильдия': { es: 'gremio' },
  'клан': { es: 'clan' },
  'босс': { es: 'jefe' },
  'рейд': { es: 'incursión' },
  'задание': { es: 'misión' },
  'добыча': { es: 'botín' }
};
