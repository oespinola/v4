# Principios de SignalBridge (insumo de la constitución)

Estos son los principios que valen para TODO el proyecto, en cualquier feature. No repiten el stack (eso vive en AGENTS.md): son reglas de diseño y de proceso.

1. Aislamiento de la IA. Toda llamada a modelos de IA vive en un módulo dedicado, nunca mezclada con la lógica de negocio, y es reemplazable por un mock en los tests.
2. Grounding obligatorio. Ninguna orden usa datos que no salgan de la alerta o de una regla del PRD. Ante la duda, la alerta se rechaza con su motivo en el log, sin inventar.
3. Test-first en lo que importa. La extracción y validación de alertas, el dimensionamiento, la colocación de entrada/SL/TP y la reversión ante fallas se desarrollan con el ciclo rojo-verde-refactor: primero el test (commit con it.fails), después el código (commit que lo pasa a it).
4. Cero secretos en el código. Las credenciales (ANTHROPIC_API_KEY y las de Binance) se leen de variables de entorno (.env, que no se commitea), y la sesión de WhatsApp tampoco se commitea. Ninguna key aparece en el repo, y la API key de Binance solo tiene permiso de trading, nunca de retiro.
5. El PRD manda. No se agregan features fuera de los PRD vigentes en docs/prd/. Si algo falta, primero se cambia el PRD y el spec, después el código.

Gobernanza: los cambios a estos principios los aprueba el instructor del proyecto y se registran con un commit. La constitución se escribe en español.
