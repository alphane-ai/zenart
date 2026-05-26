package task

import "testing"

func TestCheckSchemaCompatibilityAcceptsCurrentAndOlderVersions(t *testing.T) {
	for _, version := range []int{1, 2} {
		if err := CheckSchemaCompatibility(version, 2); err != nil {
			t.Fatalf("CheckSchemaCompatibility(%d, 2) error = %v", version, err)
		}
	}
}

func TestCheckSchemaCompatibilityRejectsNewerVersion(t *testing.T) {
	err := CheckSchemaCompatibility(3, 2)
	if err == nil {
		t.Fatal("CheckSchemaCompatibility(3, 2) error = nil, want UnsupportedSchemaError")
	}

	unsupported, ok := err.(UnsupportedSchemaError)
	if !ok {
		t.Fatalf("error type = %T, want UnsupportedSchemaError", err)
	}
	if unsupported.TaskSchemaVersion != 3 {
		t.Fatalf("TaskSchemaVersion = %d, want 3", unsupported.TaskSchemaVersion)
	}
	if unsupported.MaxSchemaVersion != 2 {
		t.Fatalf("MaxSchemaVersion = %d, want 2", unsupported.MaxSchemaVersion)
	}
}

func TestCheckSchemaCompatibilityRejectsInvalidVersions(t *testing.T) {
	for _, tc := range []struct {
		name              string
		taskSchemaVersion int
		maxSchemaVersion  int
	}{
		{name: "task schema", taskSchemaVersion: 0, maxSchemaVersion: 1},
		{name: "max schema", taskSchemaVersion: 1, maxSchemaVersion: 0},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := CheckSchemaCompatibility(tc.taskSchemaVersion, tc.maxSchemaVersion); err == nil {
				t.Fatal("CheckSchemaCompatibility() error = nil, want error")
			}
		})
	}
}
