package adminapi

import "context"

type ctxKey int

const (
	staffIDKey ctxKey = iota
	staffRoleKey
)

func StaffIDFromContext(ctx context.Context) (string, bool) {
	v := ctx.Value(staffIDKey)
	s, ok := v.(string)
	return s, ok
}

func StaffRoleFromContext(ctx context.Context) (string, bool) {
	v := ctx.Value(staffRoleKey)
	s, ok := v.(string)
	return s, ok
}

func WithStaff(ctx context.Context, id, role string) context.Context {
	ctx = context.WithValue(ctx, staffIDKey, id)
	return context.WithValue(ctx, staffRoleKey, role)
}
