"""Imported automatically at interpreter startup when PYTHONPATH includes shim dir."""
try:
    import bb_trace
    bb_trace.install()
except Exception:
    pass
