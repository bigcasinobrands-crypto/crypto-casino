package games

// EffectiveThumbnailSQL resolves the URL shown to players and in merged APIs:
// staff override wins; otherwise the catalog feed value (Blue Ocean / snapshot sync).
const EffectiveThumbnailSQL = `COALESCE(NULLIF(TRIM(COALESCE(thumbnail_url_override,'')),'') , COALESCE(thumbnail_url,''))`

// EffectiveThumbnailAliased is the same expression with a table alias (e.g. "g").
func EffectiveThumbnailAliased(alias string) string {
	return `COALESCE(NULLIF(TRIM(COALESCE(` + alias + `.thumbnail_url_override,'')),'') , COALESCE(` + alias + `.thumbnail_url,''))`
}
