import pytest

from settle_pipeline.config import COUNTIES, RAW_DIR, require_env


def test_five_bay_area_counties():
    assert set(COUNTIES.values()) == {
        "San Francisco",
        "San Mateo",
        "Santa Clara",
        "Alameda",
        "Contra Costa",
    }
    assert all(fips.startswith("06") and len(fips) == 5 for fips in COUNTIES)


def test_raw_dir_is_under_repo_data():
    assert RAW_DIR.parts[-2:] == ("data", "raw")


def test_require_env_missing(monkeypatch):
    monkeypatch.delenv("SETTLE_TEST_UNSET", raising=False)
    with pytest.raises(RuntimeError, match="SETTLE_TEST_UNSET is not set"):
        require_env("SETTLE_TEST_UNSET")
