///|
struct Budget {
  mut remaining : Int
}

///|
fn validate_value(value : Json, depth : Int, budget : Budget) -> Bool {
  if depth > 64 || budget.remaining <= 0 { return false }
  budget.remaining -= 1
  match value {
    Null | True | False | String(_) => true
    Number(number, ..) => {
      // JSON would erase negative zero; infinities and NaN also cannot round-trip.
      number - number == 0.0 && (number != 0.0 || 1.0 / number > 0.0)
    }
    Array(values) => {
      for value in values {
        if !validate_value(value, depth + 1, budget) { return false }
      }
      true
    }
    Object(values) => {
      for _, value in values {
        if !validate_value(value, depth + 1, budget) { return false }
      }
      true
    }
  }
}

///|
pub fn validate_json(value : Json) -> Bool {
  validate_value(value, 0, { remaining: 100000 })
}
