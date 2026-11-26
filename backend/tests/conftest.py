import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ.pop("NEBIUS_API_KEY", None)
os.environ.setdefault("THREAD_SELF_CHECK", "0")  # tests enable the second pass explicitly
